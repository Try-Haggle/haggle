"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Avatar, Button, Field, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";

interface SettingsContentProps {
  email: string;
  displayName: string;
  avatarUrl: string;
  provider: string;
}

export function SettingsContent({ email, displayName, avatarUrl, provider }: SettingsContentProps) {
  const router = useRouter();
  const supabase = createClient();

  // Profile state
  const [name, setName] = useState(displayName);
  const [avatarPreview, setAvatarPreview] = useState(avatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<{
    type: "error";
    text: string;
  } | null>(null);

  // ── Profile ──────────────────────────────────────────────

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setProfileMsg({ type: "error", text: "Image must be under 2 MB." });
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setProfileMsg(null);
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    setProfileMsg(null);

    try {
      let newAvatarUrl = avatarUrl;

      // Upload avatar if changed
      if (avatarFile) {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user!.id;
        const ext = avatarFile.name.split(".").pop() || "jpg";
        const path = `${userId}/avatar.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });

        if (uploadErr) {
          setProfileMsg({
            type: "error",
            text: `Upload failed: ${uploadErr.message}`,
          });
          setProfileSaving(false);
          return;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(path);
        newAvatarUrl = publicUrl;
      }

      const { error } = await supabase.auth.updateUser({
        data: { display_name: name.trim(), custom_avatar_url: newAvatarUrl },
      });

      if (error) {
        setProfileMsg({ type: "error", text: error.message });
      } else {
        setProfileMsg({ type: "success", text: "Profile updated." });
        setAvatarFile(null);
        router.refresh();
      }
    } catch {
      setProfileMsg({ type: "error", text: "Something went wrong." });
    } finally {
      setProfileSaving(false);
    }
  };

  // ── Password ─────────────────────────────────────────────

  const handlePasswordSave = async () => {
    if (newPassword.length < 8) {
      setPasswordMsg({
        type: "error",
        text: "Password must be at least 8 characters.",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match." });
      return;
    }

    setPasswordSaving(true);
    setPasswordMsg(null);

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      setPasswordMsg({ type: "error", text: error.message });
    } else {
      setPasswordMsg({ type: "success", text: "Password updated." });
      setNewPassword("");
      setConfirmPassword("");
    }
    setPasswordSaving(false);
  };

  // ── Delete Account ───────────────────────────────────────

  const handleDelete = async () => {
    if (deleteConfirm !== email) return;
    setDeleting(true);
    setDeleteMsg(null);

    try {
      await api.delete("/api/account");

      await supabase.auth.signOut();
      router.push("/sign-in");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message || "Failed to delete account."
          : "Something went wrong.";
      setDeleteMsg({ type: "error", text: message });
      setDeleting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────

  const isOAuth = provider === "google";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        {/* Mobile only: back button */}
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 flex md:hidden items-center gap-1 text-sm text-ink-muted hover:text-ink-secondary transition-colors cursor-pointer"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-ink">Account Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Manage your profile and account</p>
      </div>

      {/* ── Profile Section ────────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface-raised p-4 sm:p-6 mb-6">
        <h2 className="text-base sm:text-lg font-semibold text-ink mb-4">Profile</h2>

        {/* Avatar */}
        <div className="mb-5">
          <span className="block text-sm text-ink-secondary mb-2">Avatar</span>
          <div className="flex items-center gap-4">
            <Avatar
              src={avatarPreview || undefined}
              name={name || email}
              size="lg"
              className="border border-line"
            />
            <div>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                Change
              </Button>
              <input
                id="avatar-upload"
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarSelect}
              />
              <p className="mt-1 text-xs text-ink-muted">JPG, PNG or WebP. Max 2 MB.</p>
            </div>
          </div>
        </div>

        {/* Name */}
        <Field label="Display name" htmlFor="display-name">
          <Input
            id="display-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </Field>

        {/* Email (read-only) */}
        <Field label="Email" htmlFor="email" hint="Email cannot be changed.">
          <Input id="email" type="email" value={email} disabled />
        </Field>

        {profileMsg && (
          <Alert tone={profileMsg.type} className="mb-3">
            {profileMsg.text}
          </Alert>
        )}

        <Button onClick={handleProfileSave} loading={profileSaving}>
          {profileSaving ? "Saving…" : "Save Profile"}
        </Button>
      </section>

      {/* ── Password Section ───────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface-raised p-4 sm:p-6 mb-6">
        <h2 className="text-base sm:text-lg font-semibold text-ink mb-1">Password</h2>
        <p className="text-sm text-ink-muted mb-4">
          {isOAuth
            ? "You signed in with Google. Set a password to also sign in with email."
            : "Update your password."}
        </p>

        <Field label="New password" htmlFor="new-password">
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </Field>

        <Field label="Confirm password" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
          />
        </Field>

        {passwordMsg && (
          <Alert tone={passwordMsg.type} className="mb-3">
            {passwordMsg.text}
          </Alert>
        )}

        <Button
          onClick={handlePasswordSave}
          loading={passwordSaving}
          disabled={!newPassword || !confirmPassword}
        >
          {passwordSaving ? "Saving…" : isOAuth ? "Set Password" : "Update Password"}
        </Button>
      </section>

      {/* ── Delete Account Section ─────────────────────── */}
      <section className="rounded-xl border border-error/30 bg-surface-raised p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-error mb-1">Delete Account</h2>
        <p className="text-sm text-ink-muted mb-4">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>

        {!deleteOpen ? (
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete my account
          </Button>
        ) : (
          <div className="rounded-lg border border-error/30 bg-error-soft p-4">
            <p className="text-sm text-ink-secondary mb-3">
              Type <span className="font-mono text-error">{email}</span> to confirm:
            </p>
            <Input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={email}
              className="mb-3"
            />

            {deleteMsg && (
              <Alert tone="error" className="mb-3">
                {deleteMsg.text}
              </Alert>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteConfirm !== email || deleting}
                className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Permanently Delete"}
              </button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm("");
                  setDeleteMsg(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
