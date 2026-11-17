import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type { Me } from "@/lib/session";
import { AppShell } from "@/components/layout/app-shell";

// The frame moved out of the root layout so the loading screen can show while it loads. These tests pin down that the move kept the
// sign-in rules: signed out → the plain frame, no menu; signed in → the shell with only what the roles allow; not yet finished signing in
// (must change password or set up two-step verification) → no menu, no companies, no notifications.

const state = vi.hoisted(() => ({ me: null as unknown, queried: [] as string[] }));
vi.mock("@/lib/session", async (real) => ({ ...(await real<typeof import("@/lib/session")>()), devUsers: async () => [], getMe: async () => state.me }));
vi.mock("@/lib/company-scope", () => ({
  myCompanies: async (id: string) => { state.queried.push("companies:" + id); return [{ id: "c1", name: "ASKU PLC" }]; },
  companyScope: async () => "c1",
}));
vi.mock("@/lib/db", () => ({ withUser: async (id: string, f: (tx: unknown) => unknown) => { state.queried.push("db:" + id); return f({ q: async () => [{ n: 2 }] }); } }));
vi.mock("@/lib/notifications", () => ({ loadBell: async () => ({ unread: 1, items: [] }) }));

const ACCOUNTANT = ["dashboard:view", "bank_account:view", "payment_request:view", "payment_request:create", "recurring_payment:view", "supplier:view", "report:view"];
const person = (over: Partial<Me> = {}): Me => ({ id: "u1", name: "Meron", isAdmin: false, groupReport: false, restricted: false,
  memberships: [{ company_id: "c1", company: "ASKU PLC", roles: ["ACCOUNTANT"], permissions: ACCOUNTANT }], ...over });
const render = async () => { const { SignedInFrame } = await import("@/components/layout/signed-in-frame"); return (await SignedInFrame({ children: "page" })) as ReactElement<Record<string, unknown>>; };

beforeEach(() => { state.me = null; state.queried = []; });

describe("the frame around a page", () => {
  it("signed out: the plain frame with the page, and nothing about anyone is read", async () => {
    const el = await render();
    expect(isValidElement(el)).toBe(true); expect(el.type).toBe("main"); expect(el.props.children).toBe("page");
    expect(state.queried).toEqual([]);
  });

  it("signed in: the shell, with only the pages this person's roles allow, their companies and notifications", async () => {
    state.me = person();
    const el = await render();
    expect(el.type).toBe(AppShell);
    const items = (el.props.items as { path: string }[]).map((i) => i.path);
    expect(items).toEqual(["/", "/requests", "/accounts", "/recurring", "/suppliers", "/reports"]);
    expect(items).not.toContain("/admin"); expect(items).not.toContain("/approvals");
    expect(el.props.companies).toEqual([{ id: "c1", name: "ASKU PLC" }]); expect(el.props.bell).toEqual({ unread: 1, items: [] });
    expect(el.props.details).toEqual(["ASKU PLC: accountant"]);
  });

  it("not finished signing in: the shell without a menu, companies or notifications", async () => {
    state.me = person({ restricted: true });
    const el = await render();
    expect(el.type).toBe(AppShell);
    expect(el.props.items).toEqual([]); expect(el.props.companies).toEqual([]); expect(el.props.bell).toBeNull();
    expect(state.queried.filter((q) => q.startsWith("companies:"))).toEqual([]);
  });
});
