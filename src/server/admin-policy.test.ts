import { describe, expect, it } from "vitest";
import { canResetPassword, canSetAdmin } from "./admin-policy";

const owner = { id: "owner", is_admin: true };
const admin = { id: "admin", is_admin: true };
const admin2 = { id: "admin2", is_admin: true };
const player = { id: "player", is_admin: false };
const owners = [owner.id];

describe("canResetPassword", () => {
  it("lets any admin reset a regular player's password", () => {
    expect(canResetPassword(admin, player, owners)).toBe(true);
  });

  it("never lets anyone reset their own password (no reauthentication, so a stolen session could keep the account)", () => {
    expect(canResetPassword(admin, admin, owners)).toBe(false);
    expect(canResetPassword(owner, owner, owners)).toBe(false);
    expect(canResetPassword(player, player, owners)).toBe(false);
  });

  it("never lets another admin reset the owner's password", () => {
    expect(canResetPassword(admin, owner, owners)).toBe(false);
  });

  it("only lets an owner reset another admin's password", () => {
    expect(canResetPassword(admin, admin2, owners)).toBe(false);
    expect(canResetPassword(owner, admin, owners)).toBe(true);
  });

  it("with no owners configured, admins can't reset each other", () => {
    expect(canResetPassword(owner, admin, [])).toBe(false);
    expect(canResetPassword(admin, player, [])).toBe(true);
  });
});

describe("canSetAdmin", () => {
  it("lets any admin promote a regular player", () => {
    expect(canSetAdmin(admin, player, true, owners)).toBe(true);
  });

  it("never touches the caller themselves or an owner", () => {
    expect(canSetAdmin(admin, admin, false, owners)).toBe(false);
    expect(canSetAdmin(admin, owner, false, owners)).toBe(false);
    expect(canSetAdmin(owner, owner, false, owners)).toBe(false);
  });

  it("only lets an owner demote another admin", () => {
    expect(canSetAdmin(admin, admin2, false, owners)).toBe(false);
    expect(canSetAdmin(owner, admin, false, owners)).toBe(true);
    expect(canSetAdmin(owner, admin, false, [])).toBe(false);
  });
});
