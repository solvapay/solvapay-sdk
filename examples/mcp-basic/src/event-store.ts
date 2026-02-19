import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { EventStore, StreamId, EventId } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

/**
 * Simple in-memory event store for resumability support
 */
export class SimpleEventStore implements EventStore {
  private events: Map<StreamId, Array<{ eventId: EventId; message: JSONRPCMessage }>> = new Map()

  /**
   * Generates a unique event ID for a given stream ID
   */
  private generateEventId(streamId: StreamId): EventId {
    return `${streamId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Extracts the stream ID from an event ID (format: streamId-timestamp-random)
   */
  private getStreamIdFromEventId(eventId: EventId): StreamId | undefined {
    const parts = eventId.split('-')
    if (parts.length >= 3) {
      // Remove timestamp and random parts, rejoin the rest
      return parts.slice(0, -2).join('-')
    }
    return undefined
  }

  /**
   * Stores an event with a generated event ID
   */
  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    if (!this.events.has(streamId)) {
      this.events.set(streamId, [])
    }
    const eventId = this.generateEventId(streamId)
    this.events.get(streamId)!.push({ eventId, message })
    return eventId
  }

  /**
   * Get the stream ID associated with a given event ID
   */
  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.getStreamIdFromEventId(eventId)
  }

  /**
   * Replays events that occurred after a specific event ID
   */
  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    const streamId = this.getStreamIdFromEventId(lastEventId)
    if (!streamId) {
      throw new Error(`Cannot determine stream ID for event ID: ${lastEventId}`)
    }

    const events = this.events.get(streamId) || []
    const lastIndex = events.findIndex(e => e.eventId === lastEventId)

    if (lastIndex < 0) {
      // Event not found, return stream ID anyway
      return streamId
    }

    // Replay events after the last event ID
    for (let i = lastIndex + 1; i < events.length; i++) {
      await send(events[i].eventId, events[i].message)
    }

    return streamId
  }

  clear(streamId: StreamId): void {
    this.events.delete(streamId)
  }
}

