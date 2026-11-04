import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";

const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }));
});

describe("ThemeToggle (DU-5.3)", () => {
  it("reflects the stored pref in aria-pressed", () => {
    localStorage.setItem("nos:theme-pref", "light");
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle-light")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("theme-toggle-dark")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("theme-toggle-system")).toHaveAttribute("aria-pressed", "false");
  });
  it("defaults to System pressed", () => {
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle-system")).toHaveAttribute("aria-pressed", "true");
  });
  it("Dark persists, presses and adds .dark; System with a light OS removes it", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle-dark"));
    expect(screen.getByTestId("theme-toggle-dark")).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("nos:theme-pref")).toBe("dark");
    expect(isDark()).toBe(true);
    fireEvent.click(screen.getByTestId("theme-toggle-system"));
    expect(isDark()).toBe(false);
  });
});
