export function formatTimeAgo(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatProcessingDate(dateRaw: string): string {
  if (!dateRaw || dateRaw.length < 4) return dateRaw;
  const year = dateRaw.slice(0, 4);
  const month = dateRaw.length >= 6 ? dateRaw.slice(4, 6) : "";
  const day = dateRaw.length >= 8 ? dateRaw.slice(6, 8) : "";
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthNum = Number.parseInt(month, 10);
  const dayNum = Number.parseInt(day, 10);
  if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
    return `${months[monthNum - 1]} ${dayNum}, ${year}`;
  }
  if (monthNum >= 1 && monthNum <= 12) {
    return `${months[monthNum - 1]} ${year}`;
  }
  return year;
}

export function formatCorrespondents(
  sender: string | null,
  recipient: string | null,
): string {
  if (sender && recipient) return `${sender} → ${recipient}`;
  if (sender) return `From: ${sender}`;
  if (recipient) return `To: ${recipient}`;
  return "";
}
