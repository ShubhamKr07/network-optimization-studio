import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router as WouterRouter } from "wouter";
import { Landing } from "@/pages/Landing";

function renderLanding() {
  return render(
    <WouterRouter>
      <Landing />
    </WouterRouter>,
  );
}

describe("Landing", () => {
  it("lists all three chapter labs", () => {
    renderLanding();
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
    expect(screen.getByText(/Coal Transport LP/)).toBeInTheDocument();
    expect(screen.getByText(/Brazil Capacity/)).toBeInTheDocument();
  });

  it("links each chapter to its route", () => {
    renderLanding();
    expect(screen.getByTestId("link-/chapter-3")).toHaveAttribute("href", "/chapter-3");
    expect(screen.getByTestId("link-/chapter-5/transport")).toHaveAttribute("href", "/chapter-5/transport");
    expect(screen.getByTestId("link-/chapter-5/brazil")).toHaveAttribute("href", "/chapter-5/brazil");
  });
});
