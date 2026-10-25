import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FormattedNumberInput,
  formatNumberValue,
  groupNumberText,
  sanitizeNumberText,
} from "@/components/data-table/FormattedNumberInput";

// A controlled harness: the parent stores what onChange reports, exactly like
// a demand-override handler would. Like today's demand inputs
// (CustomerTable.tsx:163-173) it passes NO aria-label — the user decided
// (2026-10-17) that none is added.
function Harness({
  initial = null as number | null,
  onValue = (_: number | null) => {},
  disabled = false,
  integer = false,
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <FormattedNumberInput
      value={value}
      onChange={v => {
        setValue(v);
        onValue(v);
      }}
      disabled={disabled}
      integer={integer}
      data-testid="input-customer-demand-C1"
    />
  );
}

const input = () => screen.getByTestId("input-customer-demand-C1") as HTMLInputElement;

describe("pure helpers", () => {
  it("sanitizeNumberText strips commas and spaces, rejects everything else", () => {
    expect(sanitizeNumberText("1, 234 567")).toBe("1234567");
    expect(sanitizeNumberText("12.5")).toBe("12.5");
    expect(sanitizeNumberText("-5")).toBeNull();
    expect(sanitizeNumberText("1e3")).toBeNull();
    expect(sanitizeNumberText("1.2.3")).toBeNull();
    expect(sanitizeNumberText("12a")).toBeNull();
  });

  it("groupNumberText groups the integer part and normalises leading zeros", () => {
    expect(groupNumberText("1234567.891")).toBe("1,234,567.891");
    expect(groupNumberText("0012")).toBe("12");
    expect(groupNumberText("000")).toBe("0");
    expect(groupNumberText("00.50")).toBe("0.50");
    expect(groupNumberText(".")).toBe("0.");
    expect(groupNumberText("")).toBe("");
  });

  it("formatNumberValue renders en-US grouping, null as empty", () => {
    expect(formatNumberValue(1234.5)).toBe("1,234.5");
    expect(formatNumberValue(0)).toBe("0");
    expect(formatNumberValue(null)).toBe("");
  });
});

describe("FormattedNumberInput", () => {
  it("is a text input with decimal inputMode and grouped en-US text", () => {
    render(<Harness initial={1234} />);
    const el = input();
    expect(el).toHaveAttribute("type", "text");
    expect(el).toHaveAttribute("inputmode", "decimal");
    expect(el.value).toBe("1,234");
  });

  it("adds no aria-label: a consumer without one (today's demand cells) stays without one", () => {
    render(<Harness initial={1} />);
    expect(input()).not.toHaveAttribute("aria-label");
  });

  it("a consumer's own aria-describedby is passed through", () => {
    render(<FormattedNumberInput value={1} onChange={() => {}} aria-describedby="hint" data-testid="x" />);
    expect(screen.getByTestId("x")).toHaveAttribute("aria-describedby", "hint");
  });

  it("integer mode (station demand): numeric inputMode, '.' rejected, digits accepted", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness integer onValue={onValue} />);
    expect(input()).toHaveAttribute("inputmode", "numeric");
    await user.type(input(), "12.5");
    expect(input().value).toBe("125");
    expect(onValue).toHaveBeenLastCalledWith(125);
    expect(sanitizeNumberText("1.5", true)).toBeNull();
    expect(sanitizeNumberText("1,500", true)).toBe("1500");
  });

  it("reformats live on each keystroke and reports numbers", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "1234");
    expect(input().value).toBe("1,234");
    expect(onValue.mock.calls.map(c => c[0])).toEqual([1, 12, 123, 1234]);
  });

  it("allows decimals; a trailing '.' keeps the text without a duplicate onChange", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "1234.5");
    expect(input().value).toBe("1,234.5");
    expect(onValue.mock.calls.map(c => c[0])).toEqual([1, 12, 123, 1234, 1234.5]);
  });

  it("keeps the caret on the same digit when a comma is inserted mid-number", async () => {
    const user = userEvent.setup();
    render(<Harness initial={1234} />);
    // "1,|234" → type 9 → "19,234" with the caret after the 9: "19|,234"
    await user.type(input(), "9", { initialSelectionStart: 2, initialSelectionEnd: 2 });
    expect(input().value).toBe("19,234");
    expect(input().selectionStart).toBe(2);
  });

  it("renders with a NaN value without an infinite re-render loop", () => {
    expect(() => render(<FormattedNumberInput value={NaN} onChange={() => {}} data-testid="input-customer-demand-C1" />)).not.toThrow();
  });

  it("Backspace right after a grouping comma deletes the digit before it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={1234} />);
    await user.click(input());
    input().setSelectionRange(2, 2); // "1,|234"
    await user.keyboard("{Backspace}");
    expect(input().value).toBe("234");
    expect(input().selectionStart).toBe(0);
  });

  it("Delete right before a grouping comma deletes the digit after it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={1234} />);
    await user.click(input());
    input().setSelectionRange(1, 1); // "1|,234"
    await user.keyboard("{Delete}");
    expect(input().value).toBe("134");
    expect(input().selectionStart).toBe(1);
  });

  it("does not leave a stale caret that applies on a later rerender", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FormattedNumberInput value={1234} onChange={() => {}} data-testid="input-customer-demand-C1" />);
    await user.click(input());
    input().setSelectionRange(5, 5);
    await user.type(input(), "x"); // rejected: no state change
    input().setSelectionRange(1, 1);
    rerender(<FormattedNumberInput value={1234} onChange={() => {}} data-testid="input-customer-demand-C1" />);
    expect(input().selectionStart).toBe(1);
  });

  it("paste strips grouping commas and spaces", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.click(input());
    await user.paste("1, 234 567");
    expect(input().value).toBe("1,234,567");
    expect(onValue).toHaveBeenLastCalledWith(1234567);
  });

  it("paste with any other character is rejected — text and value unchanged", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={50} onValue={onValue} />);
    await user.click(input());
    await user.paste("12a");
    expect(input().value).toBe("50");
    expect(onValue).not.toHaveBeenCalled();
  });

  it("negatives are rejected", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "-");
    expect(input().value).toBe("");
    expect(onValue).not.toHaveBeenCalled();
  });

  it("empty → null (clears the override)", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={7} onValue={onValue} />);
    await user.clear(input());
    expect(input().value).toBe("");
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it("select-all + type replaces the value", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={1234} onValue={onValue} />);
    await user.tripleClick(input());
    await user.keyboard("5");
    expect(input().value).toBe("5");
    expect(onValue).toHaveBeenLastCalledWith(5);
  });

  it("leading zeros are normalised", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "007");
    expect(input().value).toBe("7");
    expect(onValue).toHaveBeenLastCalledWith(7);
  });

  it("values above Number.MAX_SAFE_INTEGER are rejected", () => {
    const onValue = vi.fn();
    render(<Harness initial={1} onValue={onValue} />);
    fireEvent.change(input(), { target: { value: String(Number.MAX_SAFE_INTEGER) } });
    expect(onValue).toHaveBeenLastCalledWith(Number.MAX_SAFE_INTEGER);
    fireEvent.change(input(), { target: { value: "9007199254740992" } });
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("9,007,199,254,740,991");
  });

  it("IME: no reformat or onChange during composition; formats on compositionend", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: "1234" } });
    expect(input().value).toBe("1234");
    expect(onValue).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input());
    expect(input().value).toBe("1,234");
    expect(onValue).toHaveBeenLastCalledWith(1234);
  });

  it("an external value change resyncs the text", () => {
    const { rerender } = render(<FormattedNumberInput value={10} onChange={() => {}} data-testid="x" />);
    rerender(<FormattedNumberInput value={2500} onChange={() => {}} data-testid="x" />);
    expect((screen.getByTestId("x") as HTMLInputElement).value).toBe("2,500");
    rerender(<FormattedNumberInput value={null} onChange={() => {}} data-testid="x" />);
    expect((screen.getByTestId("x") as HTMLInputElement).value).toBe("");
  });

  it("disabled passes through (history read-only / Brazil base lock are the caller's flag)", () => {
    render(<Harness initial={5} disabled />);
    expect(input()).toBeDisabled();
  });
});
