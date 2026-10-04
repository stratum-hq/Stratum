import React from "react";
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Skeleton } from "../components/Skeleton.js";

// The corner radius comes from the theme. The base theme sets 4px and Bedrock
// sets 0, so a literal fallback would put corners back where the theme has none.

afterEach(cleanup);

describe("Skeleton", () => {
  it.each(["text", "rect"] as const)("takes the %s corner radius only from the theme token", (variant) => {
    const { getByRole } = render(<Skeleton variant={variant} />);
    expect(getByRole("status").style.borderRadius).toBe("var(--stratum-radius-sm)");
  });
});
