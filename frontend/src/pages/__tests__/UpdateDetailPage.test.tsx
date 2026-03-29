import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import UpdateDetailPage from "../UpdateDetailPage";
import type { BlogPost } from "../../api/client";

const getBlogPostMock = vi.fn();
const getImageUrlMock = vi.fn((url: string, _opts?: Record<string, unknown>) => `http://localhost:3002${url}`);

vi.mock("../../api/client", () => ({
  getBlogPost: (...args: string[]) => getBlogPostMock(...args),
  getImageUrl: (url: string, opts?: Record<string, unknown>) => getImageUrlMock(url, opts),
}));

vi.mock("../../components/SEO", () => ({
  default: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="seo" data-title={title} data-description={description} />
  ),
}));

vi.mock("../../components/Footer/Footer", () => ({
  default: () => <footer>Footer</footer>,
}));

vi.mock("../../utils/seo", () => ({
  buildBlogPostSeo: (post: BlogPost) => ({
    title: post.title,
    description: post.excerpt || "desc",
    canonicalPath: `/blog/${post.slug}`,
    ogType: "article",
    ogImage: post.heroImageUrl,
    imageAlt: post.heroImageAlt,
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    jsonLd: {},
  }),
  stripMarkdown: (s: string) => s,
  truncateText: (s: string) => s,
}));

function makePost(overrides?: Partial<BlogPost>): BlogPost {
  return {
    id: "post-1",
    slug: "hello-world",
    title: "Hello World",
    excerpt: "A greeting to the world",
    bodyMarkdown: "# Welcome\n\nThis is the **body** of the post.",
    status: "published",
    category: "update",
    authorDisplayName: "Jane Archivist",
    authorRole: "editor",
    heroImageUrl: "/blog-images/hero.jpg",
    heroImageAlt: "A hero image",
    seoTitle: null,
    seoDescription: null,
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: "2026-03-15T12:00:00Z",
    createdAt: "2026-03-14T10:00:00Z",
    updatedAt: "2026-03-15T14:00:00Z",
    ...overrides,
  };
}

function renderWithSlug(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/blog/${slug}`]}>
      <Routes>
        <Route path="/blog/:slug" element={<UpdateDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("UpdateDetailPage", () => {
  beforeEach(() => {
    getBlogPostMock.mockReset();
    getImageUrlMock.mockClear();
  });

  it("renders loading state", () => {
    getBlogPostMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithSlug("hello-world");

    expect(screen.getByText("Loading journal entry...")).toBeInTheDocument();
  });

  it("renders post content after fetch", async () => {
    getBlogPostMock.mockResolvedValue(makePost());
    renderWithSlug("hello-world");

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    // Markdown body renders heading
    expect(screen.getByText("Welcome")).toBeInTheDocument();

    // Excerpt deck
    expect(screen.getByText("A greeting to the world")).toBeInTheDocument();
  });

  it("renders 404/error state for missing post", async () => {
    getBlogPostMock.mockRejectedValue(new Error("Not found"));
    renderWithSlug("nonexistent");

    await waitFor(() => {
      expect(screen.getByText("Journal Entry Not Found")).toBeInTheDocument();
    });

    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByText(/All Journal Entries/)).toBeInTheDocument();
  });

  it("renders default error message when post is null", async () => {
    getBlogPostMock.mockResolvedValue(null);
    renderWithSlug("empty");

    await waitFor(() => {
      expect(screen.getByText("Journal Entry Not Found")).toBeInTheDocument();
    });

    expect(
      screen.getByText("This journal entry does not exist or is no longer published."),
    ).toBeInTheDocument();
  });

  it("renders hero image through getImageUrl", async () => {
    getBlogPostMock.mockResolvedValue(makePost());
    renderWithSlug("hello-world");

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    expect(getImageUrlMock).toHaveBeenCalledWith("/blog-images/hero.jpg", {
      publicOnly: true,
    });

    const img = screen.getByAltText("A hero image");
    expect(img).toHaveAttribute("src", "http://localhost:3002/blog-images/hero.jpg");
  });

  it("renders markdown content with bold and heading", async () => {
    getBlogPostMock.mockResolvedValue(
      makePost({ bodyMarkdown: "## Subtitle\n\nSome **bold** text and a [link](https://example.com)." }),
    );
    renderWithSlug("hello-world");

    await waitFor(() => {
      expect(screen.getByText("Subtitle")).toBeInTheDocument();
    });

    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute("href", "https://example.com");
  });

  it("renders author and date", async () => {
    getBlogPostMock.mockResolvedValue(makePost());
    renderWithSlug("hello-world");

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    expect(screen.getByText("Written by Jane Archivist")).toBeInTheDocument();

    const timeEl = screen.getByText("March 15, 2026");
    expect(timeEl).toBeInTheDocument();
    expect(timeEl).toHaveAttribute("datetime", "2026-03-15T12:00:00Z");
  });

  it("renders SEO metadata", async () => {
    getBlogPostMock.mockResolvedValue(makePost());
    renderWithSlug("hello-world");

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const seo = screen.getByTestId("seo");
    expect(seo).toHaveAttribute("data-title", "Hello World");
    expect(seo).toHaveAttribute("data-description", "A greeting to the world");
  });

  it("renders CTA button when ctaLabel and ctaUrl are set", async () => {
    getBlogPostMock.mockResolvedValue(
      makePost({ ctaLabel: "Donate Now", ctaUrl: "https://example.com/donate" }),
    );
    renderWithSlug("hello-world");

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const ctaLink = screen.getByRole("link", { name: "Donate Now" });
    expect(ctaLink).toHaveAttribute("href", "https://example.com/donate");
    expect(ctaLink).toHaveAttribute("target", "_blank");
  });

  it("does not render hero image when heroImageUrl is null", async () => {
    getBlogPostMock.mockResolvedValue(makePost({ heroImageUrl: null }));
    renderWithSlug("hello-world");

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
