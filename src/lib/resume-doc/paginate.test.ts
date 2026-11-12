import { describe, expect, it } from "vitest";
import { packPages, type MeasuredBlock } from "./paginate";

const GAP = 10;

/** Blocks stacked with a gap. A number is a plain block of that height; `{ head, bullets }` is an entry whose head is `head` px, then bullets of the given heights. */
function stack(specs: Array<number | { head: number; bullets: number[] }>): MeasuredBlock[] {
  let top = 0;
  return specs.map((spec, i) => {
    const id = `b${i}`;
    if (typeof spec === "number") {
      const block = { id, top, bottom: top + spec };
      top += spec + GAP;
      return block;
    }
    let y = top + spec.head;
    const bullets = spec.bullets.map((h) => {
      const b = { top: y, bottom: y + h };
      y += h;
      return b;
    });
    const block = { id, top, bottom: y, bullets };
    top = y + GAP;
    return block;
  });
}

describe("résumé pagination", () => {
  it("keeps everything on one page when it fits", () => {
    expect(packPages(stack([100, 200, 300]), 1000)).toEqual([[{ id: "b0" }, { id: "b1" }, { id: "b2" }]]);
  });

  it("moves a block that would be cut to the next page, whole", () => {
    // b2 spans 320–620; a 600px page would cut it, so it starts page 2.
    expect(packPages(stack([100, 200, 300, 50]), 600)).toEqual([[{ id: "b0" }, { id: "b1" }], [{ id: "b2" }, { id: "b3" }]]);
  });

  it("fits a block that ends exactly at the bottom of the page", () => {
    expect(packPages(stack([290, 300]), 600)).toEqual([[{ id: "b0" }, { id: "b1" }]]);
  });

  describe("splitting an entry between bullets", () => {
    it("keeps as many bullets on the page as fit, leaving at least two on each side", () => {
      // b1: head 40, six 50px bullets, from 410 to 750. A 600px page fits up to bullet 3 (ends 600).
      const pages = packPages(stack([400, { head: 40, bullets: [50, 50, 50, 50, 50, 50] }]), 600);
      expect(pages).toEqual([[{ id: "b0" }, { id: "b1", from: 0, to: 3 }], [{ id: "b1", from: 3, to: 6 }]]);
    });

    it("never leaves fewer than two bullets on the next page", () => {
      // Five bullets would fit on page 1, but that leaves one for page 2: the split falls after bullet 4.
      const pages = packPages(stack([300, { head: 40, bullets: [50, 50, 50, 50, 50, 50] }]), 600);
      expect(pages[0]!.at(-1)).toEqual({ id: "b1", from: 0, to: 4 });
      expect(pages[1]).toEqual([{ id: "b1", from: 4, to: 6 }]);
    });

    it("never leaves the head with fewer than two bullets", () => {
      // Only the head and one bullet would fit: the whole entry moves.
      const pages = packPages(stack([500, { head: 40, bullets: [50, 50, 50, 50] }]), 600);
      expect(pages).toEqual([[{ id: "b0" }], [{ id: "b1" }]]);
    });

    it("doesn't split an entry with fewer than four bullets", () => {
      const pages = packPages(stack([450, { head: 40, bullets: [50, 50, 50] }]), 600);
      expect(pages).toEqual([[{ id: "b0" }], [{ id: "b1" }]]);
    });

    it("splits one entry across three pages", () => {
      const pages = packPages(stack([{ head: 40, bullets: Array<number>(30).fill(50) }]), 600);
      expect(pages).toEqual([[{ id: "b0", from: 0, to: 11 }], [{ id: "b0", from: 11, to: 23 }], [{ id: "b0", from: 23, to: 30 }]]);
    });
  });

  describe("blocks taller than a page", () => {
    it("gives a block that can't split a page of its own, without looping", () => {
      expect(packPages(stack([100, 900, 100]), 600)).toEqual([[{ id: "b0" }], [{ id: "b1" }], [{ id: "b2" }]]);
    });

    it("lets a part that can't split further run over its page", () => {
      // Two 400px bullets can't be split from each other: they share a page and run over it.
      const pages = packPages(stack([{ head: 40, bullets: [400, 400, 400, 400] }]), 600);
      expect(pages).toEqual([[{ id: "b0", from: 0, to: 2 }], [{ id: "b0", from: 2, to: 4 }]]);
    });
  });

  it("returns one empty page for an empty résumé", () => {
    expect(packPages([], 600)).toEqual([[]]);
  });
});
