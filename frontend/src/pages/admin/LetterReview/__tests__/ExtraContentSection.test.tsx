import { type ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExtraContentSection } from "../ExtraContentSection";

const buildProps = (overrides: Partial<ComponentProps<typeof ExtraContentSection>> = {}) => ({
  letter: {
    extraContentStatus: "IN_PROGRESS",
    extraContentVerifiedAt: null,
  },
  extraContent: "notes",
  extraContentTranscribing: false,
  saving: false,
  onTranscribeExtras: vi.fn(),
  onVerifyExtraContent: vi.fn(),
  onExtraContentChange: vi.fn(),
  ...overrides,
});

describe("ExtraContentSection", () => {
  it("shows transcribe and verify controls for non-verified content", () => {
    render(<ExtraContentSection {...buildProps()} />);

    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
  });

  it("hides verify button when status is empty", () => {
    render(
      <ExtraContentSection
        {...buildProps({
          letter: {
            extraContentStatus: "EMPTY",
            extraContentVerifiedAt: null,
          },
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
  });

  it("shows verified state as read-only and allows unverify click", async () => {
    const user = userEvent.setup();
    const onVerifyExtraContent = vi.fn();

    const { container } = render(
      <ExtraContentSection
        {...buildProps({
          letter: {
            extraContentStatus: "VERIFIED",
            extraContentVerifiedAt: "2024-01-01T00:00:00.000Z",
          },
          onVerifyExtraContent,
        })}
      />,
    );

    const verifiedInfo = screen.getByText(/Verified on/).closest(".verified-info");
    expect(verifiedInfo).toBeInTheDocument();
    await user.click(verifiedInfo!);
    expect(onVerifyExtraContent).toHaveBeenCalledTimes(1);

    const editor = container.querySelector(".dynamic-editor");
    expect(editor).toHaveClass("verified");
    expect(editor).toHaveClass("read-only");
    expect(editor).toHaveAttribute("contenteditable", "false");
  });
});
