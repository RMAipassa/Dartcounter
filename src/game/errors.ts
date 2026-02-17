export class GameRuleError extends Error {
  public readonly code: string
  public readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'GameRuleError'
    this.code = code
    this.details = details
  }
}
