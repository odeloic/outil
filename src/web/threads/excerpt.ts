export function excerpt(body: string): string {
  const line = body.split('\n').find((candidate) => candidate.trim() !== '') ?? ''
  return line
    .replace(/^\s*(#{1,6}|[-*>]|\d+\.)\s+/, '')
    .replace(/[`*_]/g, '')
    .trim()
}
