import type { RefErrorCode } from "../shared/api.ts";

export class RefError extends Error {
  readonly code: RefErrorCode;

  constructor(code: RefErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
