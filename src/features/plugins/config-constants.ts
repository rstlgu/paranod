/**
 * Costanti config condivise client/server (nessun import server-only qui).
 */

/**
 * Sentinel che il server manda al client al posto dei secret impostati e che
 * il client rimanda per dire "non cambiato". Vedi config-service.ts.
 */
export const SECRET_PLACEHOLDER = '__paranod_secret__';
