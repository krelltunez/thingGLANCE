// The icons the keys draw, by Lucide name. The table is generated from
// lucide-react, the package the app draws with (scripts/gen-assets.mjs), so a
// key shows the icon the app shows.

export interface IconTable {
  /** Name to the icon's inner SVG markup (24x24, stroked). */
  icons: Record<string, string>;
}

/** The icon's markup, or null for none or a name the table does not hold. */
export function iconMarkup(table: IconTable, name: string | null | undefined): string | null {
  if (!name) return null;
  return Object.prototype.hasOwnProperty.call(table.icons, name) ? table.icons[name] : null;
}
