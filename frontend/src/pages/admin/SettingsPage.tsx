import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../api/auth';
import { createInvite } from '../../api/auth';
import { getErrorMessage } from '../../api/client';
import {
  getSettings,
  updateSettings,
  getInvites,
  getAdminUsers,
  revokeInvite,
  deleteAdminUser,
  changePassword,
  getSystemInfo,
  type InviteInfo,
  type AdminUserInfo,
  type AdminUsersResponse,
  type SystemInfo,
} from '../../api/admin/settings';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import './SettingsPage.css';

type FeedbackState = { type: 'success' | 'error'; message: string } | null;

export default function SettingsPage() {
  const navigate = useNavigate();

  // ── Data state ──────────────────────────────────────────
  const [adminUsers, setAdminUsers] = useState<AdminUserInfo[]>([]);
  const [currentUserCanDeleteAdminProfiles, setCurrentUserCanDeleteAdminProfiles] = useState(false);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Invite state ────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<FeedbackState>(null);
  const [adminUsersFeedback, setAdminUsersFeedback] = useState<FeedbackState>(null);

  // ── Password state ──────────────────────────────────────
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<FeedbackState>(null);

  // ── Settings form state ─────────────────────────────────
  const [donationOneTime, setDonationOneTime] = useState('');
  const [donationMonthly, setDonationMonthly] = useState('');
  const [donationFeedback, setDonationFeedback] = useState<FeedbackState>(null);
  const [donationSaving, setDonationSaving] = useState(false);

  const [siteTitle, setSiteTitle] = useState('');
  const [siteDescription, setSiteDescription] = useState('');
  const [metadataFeedback, setMetadataFeedback] = useState<FeedbackState>(null);
  const [metadataSaving, setMetadataSaving] = useState(false);

  const [emailGeneral, setEmailGeneral] = useState('');
  const [emailContribute, setEmailContribute] = useState('');
  const [emailResearch, setEmailResearch] = useState('');
  const [emailVolunteer, setEmailVolunteer] = useState('');
  const [emailFeedback, setEmailFeedback] = useState<FeedbackState>(null);
  const [emailSaving, setEmailSaving] = useState(false);

  const [autoTranscribe, setAutoTranscribe] = useState(false);
  const [autoTranscribeFeedback, setAutoTranscribeFeedback] = useState<FeedbackState>(null);
  const [autoTranscribeSaving, setAutoTranscribeSaving] = useState(false);
  const [logoutFeedback, setLogoutFeedback] = useState<FeedbackState>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);

  // ── Load data ───────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [settingsData, adminUsersData, invitesData, sysInfo] = await Promise.allSettled([
        getSettings(),
        getAdminUsers(),
        getInvites(),
        getSystemInfo(),
      ]);

      if (settingsData.status === 'fulfilled') {
        const s = settingsData.value;
        setDonationOneTime(s.donate_onetime_url || '');
        setDonationMonthly(s.donate_monthly_url || '');
        setSiteTitle(s.site_title || '');
        setSiteDescription(s.site_description || '');
        setEmailGeneral(s.contact_general_email || '');
        setEmailContribute(s.contact_contribute_email || '');
        setEmailResearch(s.contact_research_email || '');
        setEmailVolunteer(s.contact_volunteer_email || '');
        setAutoTranscribe(s.auto_transcribe === 'true');
      }

      if (adminUsersData.status === 'fulfilled') {
        const adminUserResponse = adminUsersData.value as AdminUsersResponse;
        setAdminUsers(adminUserResponse.users);
        setCurrentUserCanDeleteAdminProfiles(adminUserResponse.currentUserCanDeleteAdminProfiles);
      }

      if (invitesData.status === 'fulfilled') {
        setInvites(invitesData.value);
      }

      if (sysInfo.status === 'fulfilled') {
        setSystemInfo(sysInfo.value);
      }
    } catch {
      // individual section errors are handled by allSettled
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Invite handlers ─────────────────────────────────────
  const handleCreateInvite = async () => {
    setInviteLoading(true);
    setInviteFeedback(null);
    setInviteLink('');
    try {
      const result = await createInvite(inviteEmail || undefined);
      const link = `${window.location.origin}/admin-invite?token=${result.token}`;
      setInviteLink(link);
      setInviteEmail('');
      setInviteFeedback({ type: 'success', message: 'Invite link generated. It expires in 24 hours.' });
      // Refresh invites list
      try {
        const updated = await getInvites();
        setInvites(updated);
      } catch { /* non-critical */ }
    } catch (err) {
      setInviteFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to create invite.') });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteFeedback({ type: 'success', message: 'Copied to clipboard.' });
    } catch {
      setInviteFeedback({ type: 'error', message: 'Failed to copy. Select the link manually.' });
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      await revokeInvite(id);
      setInvites(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      setInviteFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to revoke invite.') });
    }
  };

  const handleDeleteAdminUser = async (user: AdminUserInfo) => {
    const confirmed = window.confirm(`Delete admin profile for ${user.email}? This removes their access immediately.`);
    if (!confirmed) {
      return;
    }

    setAdminUsersFeedback(null);

    try {
      await deleteAdminUser(user.id);
      setAdminUsers((prev) => prev.filter((adminUser) => adminUser.id !== user.id));
      try {
        const updatedInvites = await getInvites();
        setInvites(updatedInvites);
      } catch {
        // non-critical; user deletion already succeeded
      }
      setAdminUsersFeedback({ type: 'success', message: `${user.email} was removed from the admin team.` });
    } catch (err) {
      setAdminUsersFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to delete admin profile.') });
    }
  };

  // ── Password handler ────────────────────────────────────
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', message: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordFeedback({ type: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setPasswordFeedback({ type: 'success', message: 'Password changed successfully.' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to change password.') });
    } finally {
      setPasswordLoading(false);
    }
  };

  // ── Settings save handlers ──────────────────────────────
  const handleSaveDonation = async () => {
    setDonationSaving(true);
    setDonationFeedback(null);
    try {
      await updateSettings({
        donate_onetime_url: donationOneTime,
        donate_monthly_url: donationMonthly,
      });
      setDonationFeedback({ type: 'success', message: 'Donation links saved.' });
    } catch (err) {
      setDonationFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to save.') });
    } finally {
      setDonationSaving(false);
    }
  };

  const handleSaveMetadata = async () => {
    setMetadataSaving(true);
    setMetadataFeedback(null);
    try {
      await updateSettings({
        site_title: siteTitle,
        site_description: siteDescription,
      });
      setMetadataFeedback({ type: 'success', message: 'Site metadata saved.' });
    } catch (err) {
      setMetadataFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to save.') });
    } finally {
      setMetadataSaving(false);
    }
  };

  const handleSaveEmails = async () => {
    setEmailSaving(true);
    setEmailFeedback(null);
    try {
      await updateSettings({
        contact_general_email: emailGeneral,
        contact_contribute_email: emailContribute,
        contact_research_email: emailResearch,
        contact_volunteer_email: emailVolunteer,
      });
      setEmailFeedback({ type: 'success', message: 'Contact emails saved.' });
    } catch (err) {
      setEmailFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to save.') });
    } finally {
      setEmailSaving(false);
    }
  };

  // ── Auto-transcribe toggle ─────────────────────────────
  const handleToggleAutoTranscribe = async () => {
    const newValue = !autoTranscribe;
    setAutoTranscribeSaving(true);
    setAutoTranscribeFeedback(null);
    try {
      const updated = await updateSettings({
        auto_transcribe: newValue ? 'true' : 'false',
      });
      setAutoTranscribe(updated.auto_transcribe === 'true');
      setAutoTranscribeFeedback({ type: 'success', message: newValue ? 'Auto-transcribe enabled.' : 'Auto-transcribe disabled.' });
    } catch (err) {
      setAutoTranscribeFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to save.') });
    } finally {
      setAutoTranscribeSaving(false);
    }
  };

  // ── Logout ──────────────────────────────────────────────
  const handleLogout = async () => {
    setLogoutFeedback(null);
    setLogoutLoading(true);
    try {
      await logout();
      navigate('/admin-login');
    } catch (err) {
      setLogoutFeedback({
        type: 'error',
        message: getErrorMessage(
          err,
          'Could not securely log out. Please try again.',
        ),
      });
    } finally {
      setLogoutLoading(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────
  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="settings-loading">Loading settings...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="settings-page">
        <div className="settings-header">
          <div className="settings-kicker">Administration</div>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">Manage your account, site configuration, and system information.</p>
        </div>

        {/* ═══════════════════════════════════════════════════
            Account & Access
            ═══════════════════════════════════════════════════ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <Icon name="lock" size={20} className="settings-section-icon" />
            <h2>Account &amp; Access</h2>
          </div>

          {/* Invite Admin */}
          <div className="settings-subsection">
            <h3>Admin Profiles</h3>
            <p className="settings-subsection-desc">
              Accepted invites show up here as admin accounts. Only the owner account can delete other admin profiles.
            </p>
            {adminUsers.length === 0 ? (
              <p className="settings-table-empty">No admin profiles found.</p>
            ) : (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Access</th>
                      <th>Joined</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((adminUser) => (
                      <tr key={adminUser.id}>
                        <td>
                          {adminUser.email}
                          {adminUser.isCurrentUser && (
                            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>(you)</span>
                          )}
                        </td>
                        <td>{adminUser.canDeleteAdminProfiles ? 'Owner' : 'Admin'}</td>
                        <td>{formatDate(adminUser.createdAt)}</td>
                        <td>
                          {adminUser.canBeDeleted && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDeleteAdminUser(adminUser)}
                            >
                              Delete
                            </Button>
                          )}
                          {!adminUser.canBeDeleted && !adminUser.canDeleteAdminProfiles && !currentUserCanDeleteAdminProfiles && !adminUser.isCurrentUser && (
                            <span style={{ color: 'var(--text-muted)' }}>Owner only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {adminUsersFeedback && (
              <div className={`settings-feedback ${adminUsersFeedback.type}`}>
                {adminUsersFeedback.message}
              </div>
            )}
          </div>

          <hr className="settings-divider" />

          {/* Invite Admin */}
          <div className="settings-subsection">
            <h3>Invite Admin</h3>
            <p className="settings-subsection-desc">
              Generate a one-time invite link. Optionally lock it to a specific email. Every invite expires after 24 hours.
            </p>
            <div className="settings-invite-row">
              <div className="settings-form-row">
                <label htmlFor="invite-email">Email (optional)</label>
                <input
                  id="invite-email"
                  type="email"
                  placeholder="lock to email..."
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                loading={inviteLoading}
                onClick={handleCreateInvite}
              >
                Generate Invite
              </Button>
            </div>
            {inviteLink && (
              <div className="settings-invite-link">
                <input
                  type="text"
                  value={inviteLink}
                  readOnly
                  onFocus={e => e.target.select()}
                />
                <Button variant="ghost" size="sm" onClick={handleCopyInvite}>
                  Copy
                </Button>
              </div>
            )}
            {inviteFeedback && (
              <div className={`settings-feedback ${inviteFeedback.type}`}>
                {inviteFeedback.message}
              </div>
            )}
          </div>

          <hr className="settings-divider" />

          {/* Active Invites */}
          <div className="settings-subsection">
            <h3>Pending Invites ({invites.length})</h3>
            {invites.length === 0 ? (
              <p className="settings-table-empty">No pending invite links.</p>
            ) : (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Invited By</th>
                      <th>Created</th>
                      <th>Expires</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map(invite => (
                      <tr key={invite.id}>
                        <td>{invite.email || <span style={{ color: 'var(--text-muted)' }}>any</span>}</td>
                        <td>{invite.inviterEmail}</td>
                        <td>{formatDate(invite.createdAt)}</td>
                        <td>{formatDate(invite.expiresAt)}</td>
                        <td>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleRevokeInvite(invite.id)}
                          >
                            Revoke
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <hr className="settings-divider" />

          {/* Change Password */}
          <div className="settings-subsection">
            <h3>Change Password</h3>
            <form className="settings-form" onSubmit={handleChangePassword}>
              <div className="settings-form-row">
                <label htmlFor="old-password">Current Password</label>
                <input
                  id="old-password"
                  type="password"
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  required
                />
              </div>
              <div className="settings-form-row">
                <label htmlFor="new-password">New Password</label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="settings-form-row">
                <label htmlFor="confirm-password">Confirm New Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="settings-form-actions">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={passwordLoading}
                >
                  Update Password
                </Button>
                {passwordFeedback && (
                  <span className={`settings-feedback ${passwordFeedback.type}`}>
                    {passwordFeedback.message}
                  </span>
                )}
              </div>
            </form>
          </div>

        </div>

        {/* ═══════════════════════════════════════════════════
            Site Configuration
            ═══════════════════════════════════════════════════ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <Icon name="edit" size={20} className="settings-section-icon" />
            <h2>Site Configuration</h2>
          </div>

          {/* Donation Links */}
          <div className="settings-subsection">
            <h3>Donation Links</h3>
            <p className="settings-subsection-desc">URLs displayed on the public site for donations.</p>
            <div className="settings-form">
              <div className="settings-form-row">
                <label htmlFor="donation-onetime">One-Time Donation URL</label>
                <input
                  id="donation-onetime"
                  type="url"
                  placeholder="https://..."
                  value={donationOneTime}
                  onChange={e => setDonationOneTime(e.target.value)}
                />
              </div>
              <div className="settings-form-row">
                <label htmlFor="donation-monthly">Monthly Donation URL</label>
                <input
                  id="donation-monthly"
                  type="url"
                  placeholder="https://..."
                  value={donationMonthly}
                  onChange={e => setDonationMonthly(e.target.value)}
                />
              </div>
              <div className="settings-form-actions">
                <Button
                  variant="primary"
                  size="sm"
                  loading={donationSaving}
                  onClick={handleSaveDonation}
                >
                  Save
                </Button>
                {donationFeedback && (
                  <span className={`settings-feedback ${donationFeedback.type}`}>
                    {donationFeedback.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          <hr className="settings-divider" />

          {/* Site Metadata */}
          <div className="settings-subsection">
            <h3>Site Metadata</h3>
            <p className="settings-subsection-desc">Site name for the public header and page titles, plus the default page description. Changes appear after pages load; link previews that do not run JavaScript still use the built-in defaults.</p>
            <div className="settings-form">
              <div className="settings-form-row">
                <label htmlFor="site-title">Site Title</label>
                <input
                  id="site-title"
                  type="text"
                  placeholder="Letter Archive"
                  value={siteTitle}
                  onChange={e => setSiteTitle(e.target.value)}
                />
              </div>
              <div className="settings-form-row">
                <label htmlFor="site-desc">Site Description</label>
                <input
                  id="site-desc"
                  type="text"
                  placeholder="A digitized collection of historical letters"
                  value={siteDescription}
                  onChange={e => setSiteDescription(e.target.value)}
                />
              </div>
              <div className="settings-form-actions">
                <Button
                  variant="primary"
                  size="sm"
                  loading={metadataSaving}
                  onClick={handleSaveMetadata}
                >
                  Save
                </Button>
                {metadataFeedback && (
                  <span className={`settings-feedback ${metadataFeedback.type}`}>
                    {metadataFeedback.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          <hr className="settings-divider" />

          {/* Contact Emails */}
          <div className="settings-subsection">
            <h3>Contact Emails</h3>
            <p className="settings-subsection-desc">Email addresses shown on the public contact page.</p>
            <div className="settings-form">
              <div className="settings-form-row">
                <label htmlFor="email-general">General</label>
                <input
                  id="email-general"
                  type="email"
                  placeholder="info@example.com"
                  value={emailGeneral}
                  onChange={e => setEmailGeneral(e.target.value)}
                />
              </div>
              <div className="settings-form-row">
                <label htmlFor="email-contribute">Contribute</label>
                <input
                  id="email-contribute"
                  type="email"
                  placeholder="contribute@example.com"
                  value={emailContribute}
                  onChange={e => setEmailContribute(e.target.value)}
                />
              </div>
              <div className="settings-form-row">
                <label htmlFor="email-research">Research</label>
                <input
                  id="email-research"
                  type="email"
                  placeholder="research@example.com"
                  value={emailResearch}
                  onChange={e => setEmailResearch(e.target.value)}
                />
              </div>
              <div className="settings-form-row">
                <label htmlFor="email-volunteer">Volunteer</label>
                <input
                  id="email-volunteer"
                  type="email"
                  placeholder="volunteer@example.com"
                  value={emailVolunteer}
                  onChange={e => setEmailVolunteer(e.target.value)}
                />
              </div>
              <div className="settings-form-actions">
                <Button
                  variant="primary"
                  size="sm"
                  loading={emailSaving}
                  onClick={handleSaveEmails}
                >
                  Save
                </Button>
                {emailFeedback && (
                  <span className={`settings-feedback ${emailFeedback.type}`}>
                    {emailFeedback.message}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════
            Processing
            ═══════════════════════════════════════════════════ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <Icon name="process" size={20} className="settings-section-icon" />
            <h2>Processing</h2>
          </div>

          <div className="settings-subsection">
            <h3>Auto-Transcribe</h3>
            <p className="settings-subsection-desc">
              Automatically start transcription when new letters are uploaded. Only applies to L-type letters in UPLOADED state.
            </p>
            <div className="settings-toggle-row">
              <button
                type="button"
                role="switch"
                aria-checked={autoTranscribe}
                className={`settings-toggle-switch ${autoTranscribe ? 'on' : ''}`}
                disabled={autoTranscribeSaving}
                onClick={handleToggleAutoTranscribe}
              >
                <span className="settings-toggle-knob" />
              </button>
              <span className="settings-toggle-label">
                {autoTranscribe ? 'Enabled' : 'Disabled'}
              </span>
              {autoTranscribeFeedback && (
                <span className={`settings-feedback ${autoTranscribeFeedback.type}`}>
                  {autoTranscribeFeedback.message}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════
            System Info
            ═══════════════════════════════════════════════════ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <Icon name="code" size={20} className="settings-section-icon" />
            <h2>System Info</h2>
          </div>

          {systemInfo ? (
            <>
              <div className="settings-sysinfo-grid">
                <div className="settings-sysinfo-card">
                  <div className={`settings-sysinfo-value ${systemInfo.openaiEnabled ? 'enabled' : 'disabled'}`}>
                    {systemInfo.openaiEnabled ? 'Enabled' : 'Stub'}
                  </div>
                  <div className="settings-sysinfo-label">OpenAI</div>
                </div>
                <div className="settings-sysinfo-card">
                  <div className="settings-sysinfo-value">{systemInfo.letterCount}</div>
                  <div className="settings-sysinfo-label">Published Letters</div>
                </div>
                <div className="settings-sysinfo-card">
                  <div className="settings-sysinfo-value">{systemInfo.totalLetters}</div>
                  <div className="settings-sysinfo-label">Total Letters</div>
                </div>
                <div className="settings-sysinfo-card">
                  <div className="settings-sysinfo-value">{systemInfo.collectionCount}</div>
                  <div className="settings-sysinfo-label">Collections</div>
                </div>
                <div className="settings-sysinfo-card">
                  <div className="settings-sysinfo-value">{systemInfo.pendingQueue}</div>
                  <div className="settings-sysinfo-label">Pending Jobs</div>
                </div>
                <div className="settings-sysinfo-card">
                  <div className="settings-sysinfo-value settings-sysinfo-value--small">
                    {systemInfo.corsOrigins || 'default'}
                  </div>
                  <div className="settings-sysinfo-label">CORS Origins</div>
                </div>
              </div>
            </>
          ) : (
            <p className="settings-table-empty">Could not load system information.</p>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════
            Logout
            ═══════════════════════════════════════════════════ */}
        <div className="settings-logout-section">
          <p>Sign out of the admin panel on this device.</p>
          {logoutFeedback && (
            <div className={`settings-feedback ${logoutFeedback.type}`} role="alert">
              {logoutFeedback.message}
            </div>
          )}
          <Button
            variant="danger"
            size="sm"
            icon="logout"
            loading={logoutLoading}
            onClick={handleLogout}
          >
            Logout
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
