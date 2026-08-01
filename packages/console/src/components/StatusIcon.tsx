export type StatusIconKind = "pass" | "warn" | "fail" | "lock";

export default function StatusIcon({ kind }: { kind: StatusIconKind }) {
  switch (kind) {
    case "pass":
      return (
        <svg viewBox="0 0 20 20">
          <path d="M8.3 13.3 4.7 9.7l1.4-1.4 2.2 2.2 5.6-5.6 1.4 1.4z" />
        </svg>
      );
    case "warn":
      return (
        <svg viewBox="0 0 20 20">
          <path d="M10 2 1 17h18L10 2zm0 4.5 5.6 9.5H4.4L10 6.5zM9.2 9h1.6v4H9.2V9zm0 5h1.6v1.6H9.2V14z" />
        </svg>
      );
    case "fail":
      return (
        <svg viewBox="0 0 20 20">
          <path d="M10 8.6 6.4 5 5 6.4 8.6 10 5 13.6 6.4 15 10 11.4 13.6 15 15 13.6 11.4 10 15 6.4 13.6 5z" />
        </svg>
      );
    case "lock":
      return (
        <svg viewBox="0 0 20 20">
          <path d="M6 8V6a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h1zm2 0h4V6a2 2 0 1 0-4 0v2z" />
        </svg>
      );
  }
}
