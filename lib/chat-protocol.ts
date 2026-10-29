// Preserve the existing text stream protocol, including markers split across chunks.
const MARKERS = ['DIAGNOSIS', 'CLARIFY', 'COST', 'SOURCES', 'ERROR'] as const;
export function readChatStream(text: string) {
  const positions = MARKERS.map(name => ({ name, marker: `\n___${name}___`, index: text.indexOf(`\n___${name}___`) }))
    .filter(item => item.index >= 0).sort((a, b) => a.index - b.index);
  let content = positions.length ? text.slice(0, positions[0].index) : text;
  // Do not flash a partially received metadata marker in the answer.
  for (const name of MARKERS) {
    const marker = `\n___${name}___`;
    for (let size = 1; size < marker.length; size++) {
      if (content.endsWith(marker.slice(0, size))) { content = content.slice(0, -size); break; }
    }
  }
  const values: Partial<Record<typeof MARKERS[number], unknown>> = {};
  positions.forEach((item, i) => {
    const raw = text.slice(item.index + item.marker.length, positions[i + 1]?.index);
    if (item.name === 'ERROR') { values.ERROR = raw; return; }
    try { values[item.name] = JSON.parse(raw); } catch { /* Incomplete stream field. */ }
  });
  return { content, values };
}
