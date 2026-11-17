import Link from "next/link";
import { switchUser } from "@/app/actions";
import { SubmitButton } from "@/components/ui/submit-button";

/** Development only: the list is empty in production, and the action does nothing there. */
export function DevBanner({ users, current }: { users: { id: string; full_name: string }[]; current: string }) {
  return (
    <form action={switchUser} className="flex flex-wrap items-center gap-2 bg-warning-soft px-3 py-1 text-xs text-warning md:px-7">
      <label htmlFor="dev-user" className="font-semibold">Development: acting as</label>
      <select id="dev-user" name="user" defaultValue={current} className="max-w-56 !py-0.5 text-xs">{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      <SubmitButton variant="outline" size="sm" className="h-6 px-2">Switch</SubmitButton>
      <Link href="/gallery" className="ml-auto text-warning">Component gallery</Link>
    </form>
  );
}
