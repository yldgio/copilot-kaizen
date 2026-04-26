// lib/compress.mjs — Text compression for context injection
// Goal: reduce kaizen memory content to fit within LLM context budgets.
// Strategy: structural compression (keep headings, trim lists/code/prose),
// then hard truncation as a last resort.

/**
 * Compress text to fit within maxChars.
 *
 * Pass 1: Collapse redundant whitespace.
 * Pass 2: Structural compression — keep headings, trim lists/code blocks/prose.
 * Pass 3: Hard truncation if still over limit.
 *
 * @param {string} text — raw markdown text
 * @param {number} [maxChars=8000] — maximum character count for the output
 * @returns {string} compressed text
 */
export function compressText(text, maxChars = 8000) {
  if (!text) return ''

  // Pass 1 — normalize whitespace
  text = text.replace(/\n{3,}/g, '\n\n')                    // collapse 3+ blank lines
  text = text.split('\n').map(l => l.trimEnd()).join('\n')   // trim trailing whitespace per line

  if (text.length <= maxChars) return text

  // Pass 2 — structural compression
  const paragraphs = text.split('\n\n')
  const compressed = []

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    // Headings: always keep
    if (trimmed.startsWith('#')) {
      compressed.push(trimmed)
      continue
    }

    // Code blocks: keep first 5 lines
    if (trimmed.startsWith('```')) {
      const lines = trimmed.split('\n')
      if (lines.length <= 6) {  // opening ``` + up to 5 lines + closing ```
        compressed.push(trimmed)
      } else {
        const kept = lines.slice(0, 6)  // opening + 5 lines of code
        // Find if there's a closing ``` and append it
        const lastLine = lines[lines.length - 1]
        if (lastLine.trim().startsWith('```')) {
          kept.push('  // ... truncated')
          kept.push(lastLine)
        } else {
          kept.push('  // ... truncated')
          kept.push('```')
        }
        compressed.push(kept.join('\n'))
      }
      continue
    }

    // List items (- * or 1.): keep first 3
    const lines = trimmed.split('\n')
    const isListParagraph = lines.every(l => /^\s*([-*]|\d+\.)/.test(l.trim()) || l.trim() === '')
    if (isListParagraph && lines.length > 0) {
      const listLines = lines.filter(l => l.trim() !== '')
      if (listLines.length <= 3) {
        compressed.push(trimmed)
      } else {
        const kept = listLines.slice(0, 3)
        kept.push(`  _(… ${listLines.length - 3} more)_`)
        compressed.push(kept.join('\n'))
      }
      continue
    }

    // Prose paragraphs: keep first line only
    compressed.push(lines[0])
  }

  let result = compressed.join('\n\n')

  // Pass 3 — hard truncation as last resort
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '\n\n[... truncated]'
  }

  return result
}
