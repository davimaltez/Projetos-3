import type { Usuario } from "./Usuario.js";

/** Cliente histórico preserva a identidade mesmo sem nome/e-mail cadastrados. */
export interface Cliente extends Usuario<string | null> {}
