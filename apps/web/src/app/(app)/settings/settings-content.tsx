"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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
  const [avatarError, setAvatarError] = useState(false);
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
    setAvatarError(false);
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
          <label htmlFor="avatar-upload" className="block text-sm text-ink-secondary mb-2">
            Avatar
          </label>
          <div className="flex items-center gap-4">
            <div className="relative">
              {avatarPreview && !avatarError ? (
                // biome-ignore lint/performance/noImgElement: user-uploaded avatar preview
                <img
                  src={avatarPreview}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover border border-line"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-badge text-xl font-medium text-badge-text border border-line">
                  {(name || email).charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-overlay transition-colors cursor-pointer"
              >
                Change
              </button>
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
        <div className="mb-5">
          <label htmlFor="display-name" className="block text-sm text-ink-secondary mb-1.5">
            Display name
          </label>
          <input
            id="display-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-focus transition-colors"
          />
        </div>

        {/* Email (read-only) */}
        <div className="mb-5">
          <label htmlFor="email" className="block text-sm text-ink-secondary mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            disabled
            className="w-full rounded-lg border border-line bg-surface-sunken/50 px-3 py-2 text-sm text-ink-muted cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-ink-muted">Email cannot be changed.</p>
        </div>

        {profileMsg && (
          <p
            className={`mb-3 text-sm ${
              profileMsg.type === "success" ? "text-success" : "text-error"
            }`}
          >
            {profileMsg.text}
          </p>
        )}

        <button
          type="button"
          onClick={handleProfileSave}
          disabled={profileSaving}
          className="rounded-lg bg-action-primary px-4 py-2 text-sm font-medium text-on-accent hover:bg-action-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {profileSaving ? "Saving…" : "Save Profile"}
        </button>
      </section>

      {/* ── Password Section ───────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface-raised p-4 sm:p-6 mb-6">
        <h2 className="text-base sm:text-lg font-semibold text-ink mb-1">Password</h2>
        <p className="text-sm text-ink-muted mb-4">
          {isOAuth
            ? "You signed in with Google. Set a password to also sign in with email."
            : "Update your password."}
        </p>

        <div className="mb-4">
          <label htmlFor="new-password" className="block text-sm text-ink-secondary mb-1.5">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-focus transition-colors"
          />
        </div>

        <div className="mb-4">
          <label htmlFor="confirm-password" className="block text-sm text-ink-secondary mb-1.5">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
            className="w-full rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-focus transition-colors"
          />
        </div>

        {passwordMsg && (
          <p
            className={`mb-3 text-sm ${
              passwordMsg.type === "success" ? "text-success" : "text-error"
            }`}
          >
            {passwordMsg.text}
          </p>
        )}

        <button
          type="button"
          onClick={handlePasswordSave}
          disabled={passwordSaving || !newPassword || !confirmPassword}
          className="rounded-lg bg-action-primary px-4 py-2 text-sm font-medium text-on-accent hover:bg-action-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {passwordSaving ? "Saving…" : isOAuth ? "Set Password" : "Update Password"}
        </button>
      </section>

      {/* ── Delete Account Section ─────────────────────── */}
      <section className="rounded-xl border border-error/30 bg-surface-raised p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-error mb-1">Delete Account</h2>
        <p className="text-sm text-ink-muted mb-4">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>

        {!deleteOpen ? (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="rounded-lg border border-error px-4 py-2 text-sm font-medium text-error hover:bg-error-soft transition-colors cursor-pointer"
          >
            Delete my account
          </button>
        ) : (
          <div className="rounded-lg border border-error/30 bg-error-soft p-4">
            <p className="text-sm text-ink-secondary mb-3">
              Type <span className="font-mono text-error">{email}</span> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={email}
              className="w-full rounded-lg border border-error/30 bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none focus:border-error transition-colors mb-3"
            />

            {deleteMsg && <p className="mb-3 text-sm text-error">{deleteMsg.text}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteConfirm !== email || deleting}
                className="rounded-lg bg-error-500 px-4 py-2 text-sm font-medium text-on-accent hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {deleting ? "Deleting…" : "Permanently Delete"}
              </button>
              <button
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm("");
                  setDeleteMsg(null);
                }}
                type="button"
                className="rounded-lg border border-line px-4 py-2 text-sm text-ink-secondary hover:bg-surface-sunken transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
