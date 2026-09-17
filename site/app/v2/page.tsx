// /v2 was the redesign's preview address while it was built beside the old
// page. It is now the page itself; the address stays so links shared during
// review keep working.

export { default } from "../page";

/** Re-prerender every 5 minutes, as / does. Declared here because Next reads
 *  this field statically and will not follow a re-export. */
export const revalidate = 300;
