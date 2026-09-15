# frozen_string_literal: true

module SolvaPay
  # Single-flight table: one in-flight lookup per key, waiters share the result.
  class InflightTable
    def initialize(mutex)
      @mutex = mutex
      @inflight = {} #: Hash[untyped, untyped]
    end

    def run(key)
      state, leader = acquire(key)
      return await(state) unless leader

      begin
        result = yield
        publish(key, state, result: result)
        result
      rescue StandardError => e
        publish(key, state, error: e)
        raise
      end
    end

    private

    def acquire(key)
      @mutex.synchronize do
        existing = @inflight[key]
        return [existing, false] if existing

        state = { condition: ConditionVariable.new, done: false, result: nil, error: nil }
        @inflight[key] = state
        [state, true]
      end
    end

    def await(state)
      @mutex.synchronize do
        state.fetch(:condition).wait(@mutex) until state.fetch(:done)
        raise state[:error] if state[:error]

        state.fetch(:result)
      end
    end

    def publish(key, state, result: nil, error: nil)
      @mutex.synchronize do
        state[:result] = result
        state[:error] = error
        state[:done] = true
        @inflight.delete(key)
        state.fetch(:condition).broadcast
      end
    end
  end
end
