import chalk from 'chalk';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorType: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** `hint` may add one dim line after an `ApiError` (e.g. which plan a route needs). */
export function withErrorHandling(
  fn: (...args: any[]) => Promise<void>,
  hint?: (error: ApiError) => string | undefined,
) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        console.error(chalk.red(`Error ${error.statusCode}: ${error.errorType}`));
        console.error(error.message);
        const line = hint?.(error);
        if (line) console.error(chalk.dim(line));
      } else if (error instanceof Error) {
        console.error(chalk.red('Error:'), error.message);
      } else {
        console.error(chalk.red('An unexpected error occurred'));
      }
      process.exit(1);
    }
  };
}
