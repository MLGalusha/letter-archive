import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import UpdatesPage from "../UpdatesPage";
import type { BlogPost } from "../../api/client";

const listBlogPostsMock = vi.fn();
const getImageUrlMock = vi.fn((url: string, _opts?: Record<string, unknown>) => `http://localhost:3002${url}`);

vi.mock("../../api/client", () => ({
  listBlogPosts: (params?: Record<string, unknown>) => listBlogPostsMock(params),
  getImageUrl: (url: string, opts?: Record<string, unknown>) => getImageUrlMock(url, opts),
}));

vi.mock("../../components/SEO", () => ({
  default: () => null,
}));

vi.mock("../../components/Footer/Footer", () => ({
  default: () => <footer>Footer</footer>,
}));

vi.mock("../../utils/seo", () => ({
  buildBlogIndexSeo: () => ({
    title: "Journal",
    description: "Journal entries",
    canonicalPath: "/blog",
    jsonLd: {},
  }),
  stripMarkdown: (s: string) => s,
  truncateText: (s: string) => s,
}));

vi.mock("../../utils/searchPersistence", () => ({
  saveJournalSort: vi.fn(),
  loadJournalSort: () => null,
}));

function makeBlogPost(index: number, overrides?: Partial<BlogPost>): BlogPost {
  return {
    id: `post-${index}`,
    slug: `post-${index}`,
    title: `Post ${index}`,
    excerpt: `Excerpt for post ${index}`,
    bodyMarkdown: `Body of post ${index}`,
    status: "published",
    category: null,
    authorDisplayName: `Author ${index}`,
    authorRole: null,
    heroImageUrl: `/blog-images/hero-${index}.jpg`,
    heroImageAlt: `Hero alt ${index}`,
    seoTitle: null,
    seoDescription: null,
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: `2026-03-${String(index).padStart(2, "0")}T12:00:00Z`,
    createdAt: `2026-03-${String(index).padStart(2, "0")}T10:00:00Z`,
    updatedAt: `2026-03-${String(index).padStart(2, "0")}T12:00:00Z`,
    ...overrides,
  };
}

describe("UpdatesPage", () => {
  beforeEach(() => {
    listBlogPostsMock.mockReset();
    getImageUrlMock.mockClear();
  });

  it("renders loading state", () => {
    listBlogPostsMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <MemoryRouter>
        <UpdatesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading journal entries...")).toBeInTheDocument();
  });

  it("renders journal posts after fetch", async () => {
    const posts = [makeBlogPost(1), makeBlogPost(2), makeBlogPost(3)];
    listBlogPostsMock.mockResolvedValue({ posts, total: 3 });

    render(
      <MemoryRouter>
        <UpdatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Post 1")).toBeInTheDocument();
    });

    expect(screen.getByText("Post 2")).toBeInTheDocument();
    expect(screen.getByText("Post 3")).toBeInTheDocument();
    expect(screen.getByText("Author 1")).toBeInTheDocument();
    expect(screen.getByText("Excerpt for post 2")).toBeInTheDocument();
  });

  it("renders empty state when no posts", async () => {
    listBlogPostsMock.mockResolvedValue({ posts: [], total: 0 });

    render(
      <MemoryRouter>
        <UpdatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No journal entries yet. Check back soon."),
      ).toBeInTheDocument();
    });
  });

  it("renders error state on fetch failure", async () => {
    listBlogPostsMock.mockRejectedValue(new Error("Network error"));

    render(
      <MemoryRouter>
        <UpdatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("sort dropdown changes sort field and re-fetches", async () => {
    const user = userEvent.setup();
    const posts = [makeBlogPost(1), makeBlogPost(2)];
    listBlogPostsMock.mockResolvedValue({ posts, total: 2 });

    const { container } = render(
      <MemoryRouter>
        <UpdatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Post 1")).toBeInTheDocument();
    });

    // Initial fetch uses date/desc
    expect(listBlogPostsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "date", sortOrder: "desc" }),
    );

    // Open dropdown and select Title
    await user.click(screen.getByLabelText("Sort journal entries"));
    const titleOption = container.querySelectorAll(".sort-option")[1]; // Title is 2nd
    await user.click(titleOption);

    await waitFor(() => {
      expect(listBlogPostsMock).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "title", sortOrder: "asc" }),
      );
    });

    // Open dropdown again and click active "Title" to toggle direction
    await user.click(screen.getByLabelText("Sort journal entries"));
    const titleOptionAgain = container.querySelectorAll(".sort-option")[1];
    await user.click(titleOptionAgain);

    await waitFor(() => {
      expect(listBlogPostsMock).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "title", sortOrder: "desc" }),
      );
    });
  });

  it("pagination renders page links when total exceeds page size", async () => {
    const posts = Array.from({ length: 12 }, (_, i) => makeBlogPost(i + 1));
    listBlogPostsMock.mockResolvedValue({ posts, total: 24 });

    render(
      <MemoryRouter initialEntries={["/blog"]}>
        <UpdatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Post 1")).toBeInTheDocument();
    });

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Older posts")).toBeInTheDocument();
  });

  it("page 2 shows Newer posts link and correct page label", async () => {
    const posts = Array.from({ length: 12 }, (_, i) => makeBlogPost(i + 13));
    listBlogPostsMock.mockResolvedValue({ posts, total: 24 });

    render(
      <MemoryRouter initialEntries={["/blog?page=2"]}>
        <UpdatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Post 13")).toBeInTheDocument();
    });

    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Newer posts")).toBeInTheDocument();

    // On last page there should be no "Older posts" link
    expect(screen.queryByText("Older posts")).not.toBeInTheDocument();
  });

  it("hero images use getImageUrl", async () => {
    const posts = [makeBlogPost(1, { heroImageUrl: "/blog-images/special.jpg" })];
    listBlogPostsMock.mockResolvedValue({ posts, total: 1 });

    render(
      <MemoryRouter>
        <UpdatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Post 1")).toBeInTheDocument();
    });

    expect(getImageUrlMock).toHaveBeenCalledWith("/blog-images/special.jpg", {
      publicOnly: true,
    });

    const img = screen.getByAltText("Hero alt 1");
    expect(img).toHaveAttribute("src", "http://localhost:3002/blog-images/special.jpg");
  });
});
