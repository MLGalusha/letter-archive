import { type ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhotoDescriptionSection } from "../PhotoDescriptionSection";

const buildProps = (
  overrides: Partial<ComponentProps<typeof PhotoDescriptionSection>> = {},
) => ({
  letter: {
    photoDescriptionStatus: "AI_DRAFT",
    photoDescriptionVerifiedAt: null,
    photoDescriptionContext: "Likely the Smith family porch.",
  },
  photoDescription: "A family stands together on a porch.",
  photoDescriptionGenerating: false,
  saving: false,
  onDescribePhoto: vi.fn(),
  onVerifyPhotoDescription: vi.fn(),
  onPhotoDescriptionChange: vi.fn(),
  ...overrides,
});

describe("PhotoDescriptionSection", () => {
  it("shows generation, verification, and saved-context state for a draft", () => {
    render(<PhotoDescriptionSection {...buildProps()} />);

    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
    expect(screen.getByText("AI context saved")).toBeInTheDocument();
  });

  it("shows the initial describe action without an empty verify action", () => {
    render(
      <PhotoDescriptionSection
        {...buildProps({
          letter: {
            photoDescriptionStatus: "EMPTY",
            photoDescriptionVerifiedAt: null,
          },
          photoDescription: "",
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Describe Photo" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
  });

  it("keeps verified content read-only and delegates verification removal", async () => {
    const user = userEvent.setup();
    const onVerifyPhotoDescription = vi.fn();
    const { container } = render(
      <PhotoDescriptionSection
        {...buildProps({
          letter: {
            photoDescriptionStatus: "VERIFIED",
            photoDescriptionVerifiedAt: "2024-01-01T00:00:00.000Z",
          },
          onVerifyPhotoDescription,
        })}
      />,
    );

    await user.click(screen.getByText(/Verified on/).closest(".verified-info")!);

    expect(onVerifyPhotoDescription).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".dynamic-editor")).toHaveAttribute(
      "contenteditable",
      "false",
    );
  });
});
