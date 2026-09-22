# frozen_string_literal: true

require_relative "format"

module BitcoinAnalytics
  module Analysis
    ERA_LENGTH = 210_000
    SECONDS_PER_BLOCK = 600
    SATS_PER_BTC = Format::SATS_PER_BTC

    module_function

    def network_snapshot(btcnode_info:, mempool_height:, mempool_hash:, difficulty_adjustment:, halving:)
      info = optional_hash(btcnode_info)
      adj = optional_hash(difficulty_adjustment)
      halv = optional_hash(halving)
      mempool_height = mempool_height.nil? ? nil : Integer(mempool_height)
      btcnode_height = info && require_int(info, "blocks")
      {
        "mempoolTipHeight" => mempool_height,
        "mempoolTipHash" => mempool_hash.nil? ? nil : String(mempool_hash),
        "btcnodeTipHeight" => btcnode_height,
        "btcnodeChain" => info && require_string(info, "chain"),
        "btcnodeConnections" => info && require_int(info, "connections"),
        "heightDelta" => mempool_height.nil? || btcnode_height.nil? ? nil : mempool_height - btcnode_height,
        "difficultyRaw" => info && require_string(info, "difficulty"),
        "retargetProgressPercent" => adj && require_number(adj, "progressPercent"),
        "difficultyChangePercent" => adj && require_number(adj, "difficultyChange"),
        "remainingBlocks" => adj && require_int(adj, "remainingBlocks"),
        "remainingTimeMs" => adj && require_int(adj, "remainingTime"),
        "estimatedRetargetDateMs" => adj && require_int(adj, "estimatedRetargetDate"),
        "previousTimeSeconds" => adj && require_int(adj, "previousTime"),
        "nextRetargetHeight" => adj && require_int(adj, "nextRetargetHeight"),
        "era" => halv && require_int(halv, "era"),
        "rewardBtc" => halv && require_number(halv, "rewardBtc"),
      }
    end

    def halving_outlook(halving:, tip_height:)
      halv = optional_hash(halving)
      tip = tip_height.nil? ? nil : Integer(tip_height)
      return empty_halving(tip) if halv.nil?

      reward = require_number(halv, "rewardBtc")
      until_next = require_int(halv, "blocksUntilNextHalving")
      into_era = require_int(halv, "blocksIntoEra")
      {
        "tipHeight" => tip,
        "era" => require_int(halv, "era"),
        "rewardBtc" => reward,
        "blocksIntoEra" => into_era,
        "blocksUntilNextHalving" => until_next,
        "nextHalvingBlock" => require_int(halv, "nextHalvingBlock"),
        "eraLengthBlocks" => ERA_LENGTH,
        "eraProgress" => into_era / ERA_LENGTH.to_f,
        "estimatedSecondsToHalving" => until_next * SECONDS_PER_BLOCK,
        "issuanceEnded" => reward.zero?,
      }
    end

    def fee_outlook(recommended:, precise:, mempool_blocks:, btcnode_fees:, predict:)
      rec = optional_hash(recommended)
      prec = optional_hash(precise)
      fees = optional_hash(btcnode_fees)
      pred = optional_hash(predict)
      first_block = optional_first_block(mempool_blocks)
      next3 = pred && require_hash(pred["next_3_blocks"], "predict.next_3_blocks")
      {
        "recommendedFastestFeeSatsPerVb" => rec && require_number(rec, "fastestFee"),
        "preciseFastestFeeSatsPerVb" => prec && require_number(prec, "fastestFee"),
        "preciseHalfHourFeeSatsPerVb" => prec && require_number(prec, "halfHourFee"),
        "preciseHourFeeSatsPerVb" => prec && require_number(prec, "hourFee"),
        "preciseEconomyFeeSatsPerVb" => prec && require_number(prec, "economyFee"),
        "preciseMinimumFeeSatsPerVb" => prec && require_number(prec, "minimumFee"),
        "nextBlockMedianFeeSatsPerVb" => first_block && require_number(first_block, "medianFee"),
        "nextBlockFeeSats" => first_block && require_int(first_block, "totalFees"),
        "btcnodeHighSatsPerVb" => fees && require_int(fees, "high"),
        "btcnodeMediumSatsPerVb" => fees && require_int(fees, "medium"),
        "btcnodeLowSatsPerVb" => fees && require_int(fees, "low"),
        "predictBlock1SatsPerVb" => next3 && require_number(next3, "block_1"),
        "predictBlock2SatsPerVb" => next3 && require_number(next3, "block_2"),
        "predictBlock3SatsPerVb" => next3 && require_number(next3, "block_3"),
        "notes" => ["mempool.space recommended floors at 1 sat/vB; precise preserves sub-1 rates"],
      }
    end

    def mempool_health(mempool:, recent:, btcnode_mempool:)
      space = optional_hash(mempool)
      node = optional_hash(btcnode_mempool)
      space_count = space && require_int(space, "count")
      node_count = node && require_int(node, "pending_tx")
      {
        "mempoolPendingTx" => space_count,
        "btcnodePendingTx" => node_count,
        "pendingTxDelta" => space_count.nil? || node_count.nil? ? nil : space_count - node_count,
        "mempoolVsize" => space && require_int(space, "vsize"),
        "mempoolTotalFeeSats" => space && require_int(space, "total_fee"),
        "btcnodeMempoolMb" => node && require_string(node, "mempool_mb"),
        "recent" => recent.nil? ? [] : require_array(recent, "recent").map { |tx| recent_tx(tx) },
        "notes" => [
          "pendingTxDelta is a count. mempool.space vsize (vBytes) and btcnode mempool_mb " \
          "(serialized megabytes) are not the same measure and must not be subtracted.",
        ],
      }
    end

    def address_brief(address:)
      return { "confirmedBalanceSats" => nil, "mempoolDeltaSats" => nil, "utxoCount" => nil, "txCount" => nil } if address.nil?

      addr = require_hash(address, "address")
      chain = require_hash(addr["chain_stats"], "chain_stats")
      mempool = require_hash(addr["mempool_stats"], "mempool_stats")
      funded = require_int(chain, "funded_txo_sum")
      spent = require_int(chain, "spent_txo_sum")
      {
        "confirmedBalanceSats" => funded - spent,
        "mempoolDeltaSats" => require_int(mempool, "funded_txo_sum") - require_int(mempool, "spent_txo_sum"),
        "utxoCount" => require_int(chain, "funded_txo_count") - require_int(chain, "spent_txo_count"),
        "txCount" => require_int(chain, "tx_count"),
      }
    end

    def tx_brief(tx:, status:, tip_height:, btcnode_tx:, trace: nil)
      body = optional_hash(tx)
      st = optional_hash(status)
      node = optional_hash(btcnode_tx)
      weight = body && require_number(body, "weight")
      fee = body && require_int(body, "fee")
      vsize = weight && weight / 4.0
      block_height = st && st["block_height"]
      derived = if block_height.nil? || tip_height.nil?
                  nil
                else
                  Integer(tip_height) - Integer(block_height) + 1
                end
      {
        "txid" => body && require_string(body, "txid"),
        "feeSats" => fee,
        "sizeBytes" => body && require_int(body, "size"),
        "weight" => weight,
        "vsize" => vsize,
        "feeRateSatsPerVb" => fee && vsize && fee / vsize,
        "confirmed" => st && st.fetch("confirmed"),
        "blockHeight" => block_height,
        "blockTimeSeconds" => st && st["block_time"],
        "derivedConfirmations" => derived,
        "btcnodeConfirmations" => node && node.fetch("confirmations"),
        "btcnodeBlockHeight" => node && node.fetch("block_height"),
        "trace" => normalize_trace(trace),
      }
    end

    def miner_revenue_split(halving:, mempool_blocks:, tip_height:)
      halv = optional_hash(halving)
      first_block = optional_first_block(mempool_blocks)
      reward_btc = halv && require_number(halv, "rewardBtc")
      subsidy = reward_btc && (reward_btc * SATS_PER_BTC).round
      fees = first_block && require_int(first_block, "totalFees")
      total = subsidy.nil? || fees.nil? ? nil : subsidy + fees
      {
        "tipHeight" => tip_height.nil? ? nil : Integer(tip_height),
        "era" => halv && require_int(halv, "era"),
        "subsidySats" => subsidy,
        "nextBlockFeeSats" => fees,
        "totalRewardSats" => total,
        "feeShareOfRewardPercent" => total.nil? || total.zero? ? nil : (fees / total.to_f) * 100.0,
      }
    end

    def optional_hash(value)
      return nil if value.nil?

      require_hash(value, "payload")
    end

    def optional_first_block(mempool_blocks)
      return nil if mempool_blocks.nil?

      require_first_block(mempool_blocks)
    end

    def empty_halving(tip)
      {
        "tipHeight" => tip,
        "era" => nil,
        "rewardBtc" => nil,
        "blocksIntoEra" => nil,
        "blocksUntilNextHalving" => nil,
        "nextHalvingBlock" => nil,
        "eraLengthBlocks" => ERA_LENGTH,
        "eraProgress" => nil,
        "estimatedSecondsToHalving" => nil,
        "issuanceEnded" => nil,
      }
    end

    def require_hash(value, name)
      return value if value.is_a?(Hash)

      raise KeyError, "#{name} must be a Hash"
    end

    def require_array(value, name)
      return value if value.is_a?(Array)

      raise KeyError, "#{name} must be an Array"
    end

    def require_int(hash, key)
      value = fetch_required(hash, key)
      Integer(value)
    rescue ArgumentError, TypeError
      raise KeyError, "#{key} must be an integer"
    end

    def require_number(hash, key)
      value = fetch_required(hash, key)
      Float(value)
    rescue ArgumentError, TypeError
      raise KeyError, "#{key} must be a number"
    end

    def require_string(hash, key)
      value = fetch_required(hash, key)
      return value if value.is_a?(String)

      raise KeyError, "#{key} must be a string"
    end

    def fetch_required(hash, key)
      raise KeyError, "missing required key: #{key}" unless hash.key?(key)

      hash.fetch(key)
    end

    def require_first_block(mempool_blocks)
      blocks = require_array(mempool_blocks, "mempool_blocks")
      raise KeyError, "mempool_blocks must not be empty" if blocks.empty?

      require_hash(blocks.first, "mempool_blocks[0]")
    end

    def recent_tx(tx)
      row = require_hash(tx, "recent[]")
      {
        "txid" => row["txid"],
        "feeSats" => require_int(row, "fee"),
        "vsize" => require_int(row, "vsize"),
        "valueSats" => require_int(row, "value"),
      }
    end

    def normalize_trace(trace)
      return nil if trace.nil?

      root = require_hash(trace, "trace")
      { "inputs" => normalize_inputs(root["inputs"], depth: 0) }
    end

    def normalize_inputs(inputs, depth:)
      return [] if inputs.nil? || depth >= 2

      require_array(inputs, "trace.inputs").first(4).map do |input|
        row = require_hash(input, "trace.input")
        btc = Float(row.fetch("value"))
        {
          "valueSats" => (btc * SATS_PER_BTC).round,
          "funding_sources" => normalize_inputs(row["funding_sources"], depth: depth + 1),
        }
      end
    end
  end
end
