// Plain-text preview of rich text (markdown markers, colors and images stripped),
// used for history excerpts, activity entries and notifications.
function plainTextOf(text, max = 160) {
  const plain = String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{color(?::[^}]*)?\}/g, '')
    .replace(/(\*\*|__|\+\+|~~|==|`)/g, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

module.exports = { plainTextOf };
