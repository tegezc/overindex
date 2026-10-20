/**
 * Next.js copies the socket address into `x-forwarded-for` when the client
 * did not send that header. A TLS proxy on the same VM is expected to set it.
 * The first hop is the client address.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  const first = forwarded.split(",")[0]?.trim() ?? "";
  return first || "unknown";
}
