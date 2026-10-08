// One Opper project and runtime key per user, in SolvaPay's Opper organisation
// (prototype spec §2.1 rule 6, §8.2a). The clone holds the key; the caller
// never sees it. These keys stand in for Opper's own per-customer accounting,
// so they stay in the clone and never move into the SDK.
import {
  decryptString,
  encryptString,
  parseEncryptedPayload,
  type EncryptedPayload,
} from '../lib/crypto'
import { isRecord, requireInteger, requireString } from '../lib/guards'
import type { KvStore } from '../lib/kv-store'
import type { OpperManagement, ProjectSpend } from './opper-client'

const KEY_NAME = 'opper-clone'

export interface OpenAccount {
  projectUuid: string
  projectName: string
  runtimeKey: string
}

/** The spec's `ProviderAccount` (§8.2a), keyed by the clone's user ref. */
export interface ProviderAccount {
  open(userRef: string): Promise<OpenAccount>
  readSpend(userRef: string): Promise<ProjectSpend>
  close(userRef: string): Promise<void>
}

interface AccountRecord {
  version: 1
  userRef: string
  projectUuid: string
  projectName: string
  keyId: number
  key: EncryptedPayload
}

export class OpperAccounts implements ProviderAccount {
  private readonly opening = new Map<string, Promise<OpenAccount>>()

  constructor(
    private readonly opper: OpperManagement,
    private readonly store: KvStore,
    private readonly encryptionKey: CryptoKey,
  ) {}

  /** Returns the user's project and key, creating both on the first call. */
  open(userRef: string): Promise<OpenAccount> {
    const inFlight = this.opening.get(userRef)
    if (inFlight) return inFlight
    const opening = this.openOnce(userRef).finally(() => this.opening.delete(userRef))
    this.opening.set(userRef, opening)
    return opening
  }

  async readSpend(userRef: string): Promise<ProjectSpend> {
    const record = await this.requireRecord(userRef)
    return this.opper.getMe(await decryptString(this.encryptionKey, record.key))
  }

  /** Revokes the key and keeps the project, so Opper's spend history stays visible. */
  async close(userRef: string): Promise<void> {
    const record = await this.requireRecord(userRef)
    await this.opper.deleteKey(record.projectUuid, record.keyId)
    await this.store.delete(recordKey(userRef))
  }

  private async openOnce(userRef: string): Promise<OpenAccount> {
    const stored = await this.readRecord(userRef)
    if (stored) {
      return {
        projectUuid: stored.projectUuid,
        projectName: stored.projectName,
        runtimeKey: await decryptString(this.encryptionKey, stored.key),
      }
    }
    const project = await this.opper.createProject(`sp-${userRef}`)
    const minted = await this.mint(project.uuid, userRef)
    await this.store.put(
      recordKey(userRef),
      JSON.stringify({
        version: 1,
        userRef,
        projectUuid: project.uuid,
        projectName: project.name,
        keyId: minted.id,
        key: await encryptString(this.encryptionKey, minted.key),
      } satisfies AccountRecord),
    )
    return { projectUuid: project.uuid, projectName: project.name, runtimeKey: minted.key }
  }

  /**
   * Mints with a stable idempotency key. If Opper replays an earlier mint
   * without the secret (a previous run crashed after minting), that key is
   * unusable: revoke it and mint a fresh one.
   */
  private async mint(projectUuid: string, userRef: string): Promise<{ id: number; key: string }> {
    const first = await this.opper.mintKey(projectUuid, KEY_NAME, `${userRef}:key:1`)
    if (first.key) return { id: first.id, key: first.key }
    await this.opper.deleteKey(projectUuid, first.id)
    const second = await this.opper.mintKey(
      projectUuid,
      KEY_NAME,
      `${userRef}:key:${crypto.randomUUID()}`,
    )
    if (!second.key) throw new Error('Opper minted a key without returning the secret')
    return { id: second.id, key: second.key }
  }

  private async requireRecord(userRef: string): Promise<AccountRecord> {
    const record = await this.readRecord(userRef)
    if (!record) throw new Error(`No Opper account for ${userRef}`)
    return record
  }

  private async readRecord(userRef: string): Promise<AccountRecord | null> {
    const raw = await this.store.get(recordKey(userRef))
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || value.version !== 1) {
      throw new Error(`Account record for ${userRef} is missing version 1`)
    }
    return {
      version: 1,
      userRef: requireString(value.userRef, 'userRef'),
      projectUuid: requireString(value.projectUuid, 'projectUuid'),
      projectName: requireString(value.projectName, 'projectName'),
      keyId: requireInteger(value.keyId, 'keyId'),
      key: parseEncryptedPayload(value.key),
    }
  }
}

function recordKey(userRef: string): string {
  return `account:${userRef}`
}
