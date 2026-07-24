import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusIcon } from "../StatusIcon";

describe("StatusIcon", () => {
  it.each([
    {
      status: "EMPTY" as const,
      type: "T" as const,
      text: "—",
      title: "Transcript: Empty",
      className: "status-empty",
    },
    {
      status: "AI_DRAFT" as const,
      type: "M" as const,
      text: "Draft",
      title: "Metadata: Draft",
      className: "status-draft",
    },
    {
      status: "VERIFIED" as const,
      type: "T" as const,
      text: "✓",
      title: "Transcript: Verified",
      className: "status-verified",
    },
  ])("renders $status with its existing text, title, and class", ({
    status,
    type,
    text,
    title,
    className,
  }) => {
    render(<StatusIcon status={status} type={type} />);

    const icon = screen.getByTitle(title);
    expect(icon).toHaveTextContent(text);
    expect(icon).toHaveClass("status-icon", className);
  });

  it.each([
    ["T", "Transcript", "status-edited-transcript"],
    ["M", "Metadata", "status-edited-metadata"],
  ] as const)("keeps the %s edited track visually distinct", (
    type,
    title,
    className,
  ) => {
    render(<StatusIcon status="EDITED" type={type} />);

    const icon = screen.getByTitle(`${title}: Edited`);
    expect(icon).toHaveTextContent("Edited");
    expect(icon).toHaveClass("status-icon", "status-edited", className);
  });
});
