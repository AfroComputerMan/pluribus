import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolCallCard } from './ToolCallCard';

describe('ToolCallCard', () => {
  test('renders tool name', () => {
    render(<ToolCallCard toolName="Bash" toolInput='{"command":"ls"}' />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  test('shows tool input when expanded', () => {
    // Bash is not in defaultCollapsed, so it expands by default
    render(<ToolCallCard toolName="Bash" toolInput='{"command":"ls -la"}' />);
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
  });

  test('collapses by default for tools in defaultCollapsed set', () => {
    render(<ToolCallCard toolName="Read" toolInput='{"file_path":"/tmp/test.ts"}' />);
    // Read is in defaultCollapsed, so input should not be visible
    expect(screen.queryByText(/\/tmp\/test\.ts/)).not.toBeInTheDocument();
  });

  test('toggles expand/collapse on click', async () => {
    const user = userEvent.setup();
    render(<ToolCallCard toolName="Read" toolInput='{"file_path":"/tmp/test.ts"}' />);

    // Initially collapsed (Read is in defaultCollapsed)
    expect(screen.queryByText(/\/tmp\/test\.ts/)).not.toBeInTheDocument();

    // Click to expand
    await user.click(screen.getByRole('button'));
    expect(screen.getByText(/\/tmp\/test\.ts/)).toBeInTheDocument();

    // Click to collapse again
    await user.click(screen.getByRole('button'));
    expect(screen.queryByText(/\/tmp\/test\.ts/)).not.toBeInTheDocument();
  });

  test('respects isExpanded prop override', () => {
    render(
      <ToolCallCard toolName="Read" toolInput='{"file_path":"/tmp/f.ts"}' isExpanded />,
    );
    // Even though Read is in defaultCollapsed, isExpanded=true overrides
    expect(screen.getByText(/\/tmp\/f\.ts/)).toBeInTheDocument();
  });

  test('handles non-JSON tool input gracefully', () => {
    render(
      <ToolCallCard toolName="Bash" toolInput="plain text input" />,
    );
    expect(screen.getByText(/plain text input/)).toBeInTheDocument();
  });

  test('handles empty tool input', () => {
    render(<ToolCallCard toolName="Bash" toolInput="" />);
    // Should render without crashing; button should be visible
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  test('displays appropriate icon for known tools', () => {
    const { container } = render(
      <ToolCallCard toolName="Bash" toolInput="{}" />,
    );
    // Bash should display the laptop icon
    expect(container.textContent).toContain('\u{1F4BB}');
  });

  test('displays wrench icon for unknown tools', () => {
    const { container } = render(
      <ToolCallCard toolName="CustomTool" toolInput="{}" />,
    );
    expect(container.textContent).toContain('\u{1F527}');
  });
});
