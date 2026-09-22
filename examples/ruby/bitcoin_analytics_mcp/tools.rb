# frozen_string_literal: true

require "mcp"
require "solvapay"
require "solvapay/mcp"
require_relative "analysis"
require_relative "format"
require_relative "sources"

module BitcoinAnalytics
  module Tools
    DISCLAIMER = " Protocol facts only, not financial advice."

    module_function

    def specs(source)
      clients = {
        halving: HalvingClient.new(source),
        mempool: MempoolClient.new(source),
        btcnode: BtcnodeClient.new(source),
      }
      [
        spec(
          "network_snapshot",
          "Network snapshot",
          "Tip height from both nodes, difficulty, retarget ETA, and current subsidy.",
          ->(args, ctx) { respond_network_snapshot(args, ctx, clients) },
        ),
        spec(
          "halving_outlook",
          "Halving outlook",
          "Era, subsidy, and blocks until the next halving. Optional height overrides the tip.",
          ->(args, ctx) { respond_halving_outlook(args, ctx, clients) },
          input_schema: {
            type: "object",
            properties: { height: { type: "integer", description: "Block height to evaluate" } },
          },
        ),
        spec(
          "fee_outlook",
          "Fee outlook",
          "Unified sat/vB bands from mempool.space and btcnode, including sub-1 rates.",
          ->(args, ctx) { respond_fee_outlook(args, ctx, clients) },
        ),
        spec(
          "mempool_health",
          "Mempool health",
          "Both nodes' backlog side by side with distinct size units and a recent tx sample.",
          ->(args, ctx) { respond_mempool_health(args, ctx, clients) },
        ),
        spec(
          "address_brief",
          "Address brief",
          "Confirmed balance, mempool delta, and UTXO count from mempool.space.",
          ->(args, ctx) { respond_address_brief(args, ctx, clients) },
          input_schema: {
            type: "object",
            properties: { address: { type: "string" } },
            required: ["address"],
          },
        ),
        spec(
          "tx_brief",
          "Transaction brief",
          "Confirmation status, derived vsize/fee rate, and optional 2-hop trace in sats.",
          ->(args, ctx) { respond_tx_brief(args, ctx, clients) },
          input_schema: {
            type: "object",
            properties: {
              txid: { type: "string" },
              trace: { type: "boolean", description: "Include a capped 2-hop input trace" },
            },
            required: ["txid"],
          },
        ),
        spec(
          "miner_revenue_split",
          "Miner revenue split",
          "Next-block miner revenue as subsidy versus projected fees.",
          ->(args, ctx) { respond_miner_revenue_split(args, ctx, clients) },
        ),
      ]
    end

    def register_server(server, solvapay:, product:, source:, get_customer_ref: nil)
      specs(source).each do |item|
        SolvaPay::Mcp.register_payable_tool(
          server,
          item.fetch(:name),
          solvapay: solvapay,
          product: product,
          title: item[:title],
          description: item[:description],
          input_schema: item[:input_schema],
          handler: item.fetch(:handler),
          get_customer_ref: get_customer_ref,
        )
      end
    end

    def register_engine(engine, product:, source:)
      specs(source).each do |item|
        engine.register_payable(
          item.fetch(:name),
          product: product,
          title: item[:title],
          description: item[:description],
          input_schema: item[:input_schema],
          handler: item.fetch(:handler),
        )
      end
    end

    def spec(name, title, description, handler, input_schema: nil)
      {
        name: name,
        title: title,
        description: description + DISCLAIMER,
        handler: handler,
        input_schema: input_schema,
      }
    end

    def arg(args, key)
      args[key.to_sym] || args[key.to_s]
    end

    def require_arg(args, key)
      value = arg(args, key)
      raise ArgumentError, "#{key} is required" if value.nil? || value.to_s.empty?

      value
    end

    def try_fetch(errors)
      yield
    rescue SourceError => error
      errors << error
      nil
    end

    def failure_notes(errors)
      errors.map { |error| "Could not reach #{error.endpoint}: #{error.message}" }
    end

    def reachable_sources(*pairs)
      pairs.select { |_name, fetched| !fetched.nil? }.map(&:first)
    end

    def narrate(summary, errors)
      return summary if errors.empty?

      "#{summary} Could not reach #{errors.map(&:endpoint).uniq.join(", ")}."
    end

    def shown(value)
      Format.display(value)
    end

    def shown_count(value)
      value.nil? ? Format.display(nil) : Format.count(value)
    end

    def shown_delta(value)
      value.nil? ? Format.display(nil) : Format.signed_delta(value)
    end

    def shown_amount(value)
      value.nil? ? Format.display(nil) : Format.amount(value)
    end

    def shown_fee_rate(value)
      value.nil? ? Format.display(nil) : Format.fee_rate(value)
    end

    def shown_reward(value)
      value.nil? ? Format.display(nil) : Format.reward_btc(value)
    end

    def respond_network_snapshot(_args, ctx, clients)
      errors = []
      tip = try_fetch(errors) { clients[:mempool].tip_height }
      hash = try_fetch(errors) { clients[:mempool].tip_hash }
      adj = try_fetch(errors) { clients[:mempool].difficulty_adjustment }
      info = try_fetch(errors) { clients[:btcnode].info }
      halv = tip && try_fetch(errors) { clients[:halving].at_height(tip) }
      raw = Analysis.network_snapshot(
        btcnode_info: info,
        mempool_height: tip,
        mempool_hash: hash,
        difficulty_adjustment: adj,
        halving: halv,
      )
      Format.assert_duration_ms!(raw["remainingTimeMs"]) unless raw["remainingTimeMs"].nil?
      Format.assert_epoch_ms!(raw["estimatedRetargetDateMs"]) unless raw["estimatedRetargetDateMs"].nil?
      Format.assert_epoch_seconds!(raw["previousTimeSeconds"]) unless raw["previousTimeSeconds"].nil?
      data = raw.merge(
        "display" => {
          "mempoolTipHeight" => shown_count(raw["mempoolTipHeight"]),
          "btcnodeTipHeight" => shown_count(raw["btcnodeTipHeight"]),
          "heightDelta" => shown_delta(raw["heightDelta"]),
          "difficulty" => raw["difficultyRaw"].nil? ? Format.display(nil) : Format.difficulty(raw["difficultyRaw"]),
          "remainingTime" => raw["remainingTimeMs"].nil? ? Format.display(nil) : Format.duration_ms(raw["remainingTimeMs"]),
          "estimatedRetargetDate" =>
            raw["estimatedRetargetDateMs"].nil? ? Format.display(nil) : Format.epoch_ms(raw["estimatedRetargetDateMs"]),
          "previousTime" =>
            raw["previousTimeSeconds"].nil? ? Format.display(nil) : Format.epoch_seconds(raw["previousTimeSeconds"]),
          "difficultyChange" =>
            raw["difficultyChangePercent"].nil? ? Format.display(nil) : Format.signed_percent(raw["difficultyChangePercent"]),
          "reward" => shown_reward(raw["rewardBtc"]),
        },
        "sources" => reachable_sources(
          ["mempool.space", tip || hash || adj],
          ["btcnode.uk", info],
          ["why21million.com", halv],
        ),
        "notes" => failure_notes(errors),
      )
      summary = if raw["mempoolTipHeight"] && raw["rewardBtc"]
                  "At block #{shown_count(raw["mempoolTipHeight"])} the subsidy is #{shown_reward(raw["rewardBtc"])}" \
                    "#{raw["remainingTimeMs"] ? " and the next retarget is in #{data["display"]["remainingTime"]}" : ""}."
                elsif raw["mempoolTipHeight"]
                  "At block #{shown_count(raw["mempoolTipHeight"])}."
                else
                  "No complete network snapshot could be assembled."
                end
      ctx.respond(data, { "text" => narrate(summary, errors) })
    end

    def respond_halving_outlook(args, ctx, clients)
      errors = []
      height = arg(args, :height)
      tip = if height.nil? || height.to_s.empty?
              try_fetch(errors) { clients[:mempool].tip_height }
            else
              Integer(height)
            end
      halv = tip && try_fetch(errors) { clients[:halving].at_height(tip) }
      raw = Analysis.halving_outlook(halving: halv, tip_height: tip)
      reward = if raw["issuanceEnded"]
                 "0 BTC, issuance ended"
               else
                 shown_reward(raw["rewardBtc"])
               end
      data = raw.merge(
        "display" => {
          "tipHeight" => shown_count(raw["tipHeight"]),
          "reward" => reward,
          "blocksUntilNextHalving" => shown_count(raw["blocksUntilNextHalving"]),
          "eraProgress" => raw["eraProgress"].nil? ? Format.display(nil) : Format.percent(raw["eraProgress"] * 100.0),
          "estimatedHalving" =>
            raw["estimatedSecondsToHalving"].nil? ? Format.display(nil) : "in #{Format.count(raw["estimatedSecondsToHalving"])} seconds at 10 min/block",
        },
        "sources" => reachable_sources(["mempool.space", tip], ["why21million.com", halv]),
        "notes" => ["Halving date estimate assumes 10 minutes per block."] + failure_notes(errors),
      )
      summary = if raw["era"] && raw["blocksUntilNextHalving"]
                  "Era #{raw["era"]} pays #{reward}; #{shown_count(raw["blocksUntilNextHalving"])} blocks until the next halving."
                else
                  "Halving outlook is incomplete."
                end
      ctx.respond(data, { "text" => narrate(summary, errors) })
    end

    def respond_fee_outlook(_args, ctx, clients)
      errors = []
      recommended = try_fetch(errors) { clients[:mempool].fees_recommended }
      precise = try_fetch(errors) { clients[:mempool].fees_precise }
      blocks = try_fetch(errors) { clients[:mempool].mempool_blocks }
      btcnode_fees = try_fetch(errors) { clients[:btcnode].fees }
      predict = try_fetch(errors) { clients[:btcnode].fees_predict }
      raw = Analysis.fee_outlook(
        recommended: recommended,
        precise: precise,
        mempool_blocks: blocks,
        btcnode_fees: btcnode_fees,
        predict: predict,
      )
      data = raw.merge(
        "display" => {
          "preciseFastestFee" => shown_fee_rate(raw["preciseFastestFeeSatsPerVb"]),
          "recommendedFastestFee" => shown_fee_rate(raw["recommendedFastestFeeSatsPerVb"]),
          "nextBlockMedianFee" => shown_fee_rate(raw["nextBlockMedianFeeSatsPerVb"]),
          "nextBlockFees" => shown_amount(raw["nextBlockFeeSats"]),
          "btcnodeHigh" => shown_fee_rate(raw["btcnodeHighSatsPerVb"]),
        },
        "sources" => reachable_sources(
          ["mempool.space", recommended || precise || blocks],
          ["btcnode.uk", btcnode_fees || predict],
        ),
        "notes" => Array(raw["notes"]) + failure_notes(errors),
      )
      summary = "Next-block median is #{data["display"]["nextBlockMedianFee"]}; " \
                "precise fastest is #{data["display"]["preciseFastestFee"]}."
      ctx.respond(data, { "text" => narrate(summary, errors) })
    end

    def respond_mempool_health(_args, ctx, clients)
      errors = []
      space = try_fetch(errors) { clients[:mempool].mempool }
      recent = try_fetch(errors) { clients[:mempool].mempool_recent }
      node = try_fetch(errors) { clients[:btcnode].mempool }
      raw = Analysis.mempool_health(mempool: space, recent: recent, btcnode_mempool: node)
      data = raw.merge(
        "display" => {
          "mempoolPendingTx" => shown_count(raw["mempoolPendingTx"]),
          "btcnodePendingTx" => shown_count(raw["btcnodePendingTx"]),
          "pendingTxDelta" => shown_delta(raw["pendingTxDelta"]),
          "mempoolVsize" => raw["mempoolVsize"].nil? ? Format.display(nil) : Format.vbytes(raw["mempoolVsize"]),
          "btcnodeMempool" => raw["btcnodeMempoolMb"].nil? ? Format.display(nil) : Format.megabytes(raw["btcnodeMempoolMb"]),
        },
        "sources" => reachable_sources(["mempool.space", space || recent], ["btcnode.uk", node]),
        "notes" => Array(raw["notes"]) + failure_notes(errors),
      )
      summary = "mempool.space has #{data["display"]["mempoolPendingTx"]} pending txs " \
                "(#{data["display"]["mempoolVsize"]}); btcnode has #{data["display"]["btcnodePendingTx"]} " \
                "(#{data["display"]["btcnodeMempool"]})."
      ctx.respond(data, { "text" => narrate(summary, errors) })
    end

    def respond_address_brief(args, ctx, clients)
      address = require_arg(args, :address)
      errors = []
      payload = try_fetch(errors) { clients[:mempool].address(address) }
      raw = Analysis.address_brief(address: payload)
      data = raw.merge(
        "display" => {
          "confirmedBalance" => shown_amount(raw["confirmedBalanceSats"]),
          "mempoolDelta" => shown_amount(raw["mempoolDeltaSats"]),
          "utxoCount" => shown_count(raw["utxoCount"]),
        },
        "sources" => reachable_sources(["mempool.space", payload]),
        "notes" => ["btcnode.uk /api/addr is unavailable (HTTP 200 + success:false)."] + failure_notes(errors),
      )
      summary = "Confirmed balance #{data["display"]["confirmedBalance"]} across #{data["display"]["utxoCount"]} UTXOs."
      ctx.respond(data, { "text" => narrate(summary, errors) })
    end

    def respond_tx_brief(args, ctx, clients)
      txid = require_arg(args, :txid)
      want_trace = arg(args, :trace)
      want_trace = want_trace == true || want_trace.to_s == "true"
      errors = []
      tip = try_fetch(errors) { clients[:mempool].tip_height }
      tx = try_fetch(errors) { clients[:mempool].tx(txid) }
      status = try_fetch(errors) { clients[:mempool].tx_status(txid) }
      btcnode_tx = try_fetch(errors) { clients[:btcnode].tx(txid) }
      trace = want_trace ? try_fetch(errors) { clients[:btcnode].trace(txid) } : nil
      raw = Analysis.tx_brief(tx: tx, status: status, tip_height: tip, btcnode_tx: btcnode_tx, trace: trace)
      block_time = raw["blockTimeSeconds"]
      Format.assert_epoch_seconds!(block_time) unless block_time.nil?
      data = raw.merge(
        "display" => {
          "fee" => shown_amount(raw["feeSats"]),
          "vsize" => raw["vsize"].nil? ? Format.display(nil) : "#{raw["vsize"]} vB",
          "feeRate" => shown_fee_rate(raw["feeRateSatsPerVb"]),
          "derivedConfirmations" => shown_count(raw["derivedConfirmations"]),
          "btcnodeBlockHeight" => shown(raw["btcnodeBlockHeight"]),
          "blockTime" => block_time.nil? ? Format.display(nil) : Format.epoch_seconds(block_time),
        },
        "sources" => reachable_sources(["mempool.space", tx || status || tip], ["btcnode.uk", btcnode_tx || trace]),
        "notes" => failure_notes(errors),
      )
      summary = "Transaction has #{data["display"]["derivedConfirmations"]} confirmations at #{data["display"]["feeRate"]}."
      ctx.respond(data, { "text" => narrate(summary, errors) })
    end

    def respond_miner_revenue_split(_args, ctx, clients)
      errors = []
      tip = try_fetch(errors) { clients[:mempool].tip_height }
      halv = tip && try_fetch(errors) { clients[:halving].at_height(tip) }
      blocks = try_fetch(errors) { clients[:mempool].mempool_blocks }
      raw = Analysis.miner_revenue_split(tip_height: tip, halving: halv, mempool_blocks: blocks)
      data = raw.merge(
        "display" => {
          "tipHeight" => shown_count(raw["tipHeight"]),
          "subsidy" => shown_amount(raw["subsidySats"]),
          "nextBlockFees" => shown_amount(raw["nextBlockFeeSats"]),
          "totalReward" => shown_amount(raw["totalRewardSats"]),
          "feeShareOfReward" => raw["feeShareOfRewardPercent"].nil? ? Format.display(nil) : Format.percent(raw["feeShareOfRewardPercent"]),
        },
        "sources" => reachable_sources(
          ["mempool.space", tip || blocks],
          ["why21million.com", halv],
        ),
        "notes" => failure_notes(errors),
      )
      summary = "At block #{data["display"]["tipHeight"]} the subsidy is #{data["display"]["subsidy"]} and projected " \
                "next-block fees add #{data["display"]["nextBlockFees"]}, so fees are #{data["display"]["feeShareOfReward"]} " \
                "of miner revenue."
      ctx.respond(data, { "text" => narrate(summary, errors) })
    end
  end
end
