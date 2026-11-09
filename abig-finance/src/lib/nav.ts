/** One navigation link, as passed to the browser. `count` is a badge; zero shows nothing. */
export interface NavItem { path: string; label: string; count: number }

/** Whether a link is the current section. A page below it counts, so /requests/new highlights Payment requests. */
export const isCurrentPath = (path: string, pathname: string) => (path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/"));
