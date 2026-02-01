import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowMetadataForm } from './WorkflowMetadataForm';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore';

// Mock the store
vi.mock('@/stores/workflowBuilderStore', () => ({
  useWorkflowBuilderStore: vi.fn(),
}));

const mockStore = {
  workflowName: 'Test Workflow',
  workflowDescription: 'A test description',
  triggers: [{ type: 'manual' as const }],
  errorStrategy: { retries: 0, retryDelay: 5000, onFailure: 'stop' as const },
  setWorkflowName: vi.fn(),
  setWorkflowDescription: vi.fn(),
  setTriggers: vi.fn(),
  setErrorStrategy: vi.fn(),
};

describe('WorkflowMetadataForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useWorkflowBuilderStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockStore);
  });

  describe('name and description', () => {
    it('renders workflow name input', () => {
      render(<WorkflowMetadataForm />);

      const nameInput = screen.getByLabelText(/workflow name/i);
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveValue('Test Workflow');
    });

    it('renders description textarea', () => {
      render(<WorkflowMetadataForm />);

      const descInput = screen.getByLabelText(/description/i);
      expect(descInput).toBeInTheDocument();
      expect(descInput).toHaveValue('A test description');
    });

    it('calls setWorkflowName when name changes', () => {
      render(<WorkflowMetadataForm />);

      const nameInput = screen.getByLabelText(/workflow name/i);
      fireEvent.change(nameInput, { target: { value: 'New Name' } });

      expect(mockStore.setWorkflowName).toHaveBeenCalledWith('New Name');
    });

    it('calls setWorkflowDescription when description changes', () => {
      render(<WorkflowMetadataForm />);

      const descInput = screen.getByLabelText(/description/i);
      fireEvent.change(descInput, { target: { value: 'New description' } });

      expect(mockStore.setWorkflowDescription).toHaveBeenCalledWith('New description');
    });
  });

  describe('trigger configuration', () => {
    const expandTriggers = () => {
      const triggersHeader = screen.getByRole('button', { name: /triggers/i });
      fireEvent.click(triggersHeader);
    };

    it('shows manual trigger as always enabled', () => {
      render(<WorkflowMetadataForm />);
      expandTriggers();

      const manualCheckbox = screen.getByLabelText(/manual/i);
      expect(manualCheckbox).toBeChecked();
      expect(manualCheckbox).toBeDisabled(); // Manual is always enabled
    });

    it('shows schedule trigger checkbox', () => {
      render(<WorkflowMetadataForm />);
      expandTriggers();

      const scheduleCheckbox = screen.getByLabelText(/schedule/i);
      expect(scheduleCheckbox).toBeInTheDocument();
      expect(scheduleCheckbox).not.toBeChecked();
    });

    it('shows cron input when schedule is enabled', () => {
      (useWorkflowBuilderStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        triggers: [{ type: 'manual' }, { type: 'schedule', cron: '0 9 * * *' }],
      });

      render(<WorkflowMetadataForm />);
      expandTriggers();

      const cronInput = screen.getByLabelText(/cron expression/i);
      expect(cronInput).toBeInTheDocument();
      expect(cronInput).toHaveValue('0 9 * * *');
    });

    it('adds schedule trigger when checkbox enabled', () => {
      render(<WorkflowMetadataForm />);
      expandTriggers();

      const scheduleCheckbox = screen.getByLabelText(/schedule/i);
      fireEvent.click(scheduleCheckbox);

      expect(mockStore.setTriggers).toHaveBeenCalledWith(
        expect.arrayContaining([
          { type: 'manual' },
          { type: 'schedule', cron: '0 0 * * *' }, // Default cron
        ])
      );
    });

    it('removes schedule trigger when checkbox disabled', () => {
      (useWorkflowBuilderStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        triggers: [{ type: 'manual' }, { type: 'schedule', cron: '0 9 * * *' }],
      });

      render(<WorkflowMetadataForm />);
      expandTriggers();

      const scheduleCheckbox = screen.getByLabelText(/schedule/i);
      fireEvent.click(scheduleCheckbox);

      expect(mockStore.setTriggers).toHaveBeenCalledWith([{ type: 'manual' }]);
    });

    it('updates cron expression when changed', () => {
      (useWorkflowBuilderStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        triggers: [{ type: 'manual' }, { type: 'schedule', cron: '0 9 * * *' }],
      });

      render(<WorkflowMetadataForm />);
      expandTriggers();

      const cronInput = screen.getByLabelText(/cron expression/i);
      fireEvent.change(cronInput, { target: { value: '0 12 * * MON' } });

      expect(mockStore.setTriggers).toHaveBeenCalledWith([
        { type: 'manual' },
        { type: 'schedule', cron: '0 12 * * MON' },
      ]);
    });

    it('shows webhook trigger checkbox', () => {
      render(<WorkflowMetadataForm />);
      expandTriggers();

      const webhookCheckbox = screen.getByLabelText(/webhook/i);
      expect(webhookCheckbox).toBeInTheDocument();
    });

    it('shows webhook secret when webhook is enabled', () => {
      (useWorkflowBuilderStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockStore,
        triggers: [{ type: 'manual' }, { type: 'webhook', secret: 'secret-123' }],
      });

      render(<WorkflowMetadataForm />);
      expandTriggers();

      expect(screen.getByText(/secret-123/)).toBeInTheDocument();
    });

    it('shows API trigger checkbox', () => {
      render(<WorkflowMetadataForm />);
      expandTriggers();

      const apiCheckbox = screen.getByLabelText(/api/i);
      expect(apiCheckbox).toBeInTheDocument();
    });

    it('adds API trigger when checkbox enabled', () => {
      render(<WorkflowMetadataForm />);
      expandTriggers();

      const apiCheckbox = screen.getByLabelText(/api/i);
      fireEvent.click(apiCheckbox);

      expect(mockStore.setTriggers).toHaveBeenCalledWith(
        expect.arrayContaining([
          { type: 'manual' },
          { type: 'api' },
        ])
      );
    });
  });

  describe('error strategy configuration', () => {
    const expandErrorStrategy = () => {
      const errorStrategyHeader = screen.getByRole('button', { name: /error strategy/i });
      fireEvent.click(errorStrategyHeader);
    };

    it('renders retries input', () => {
      render(<WorkflowMetadataForm />);
      expandErrorStrategy();

      const retriesInput = screen.getByLabelText(/retries/i);
      expect(retriesInput).toBeInTheDocument();
      expect(retriesInput).toHaveValue(0);
    });

    it('renders retry delay input', () => {
      render(<WorkflowMetadataForm />);
      expandErrorStrategy();

      const delayInput = screen.getByLabelText(/retry delay/i);
      expect(delayInput).toBeInTheDocument();
      expect(delayInput).toHaveValue(5000);
    });

    it('renders on failure dropdown', () => {
      render(<WorkflowMetadataForm />);
      expandErrorStrategy();

      const failureSelect = screen.getByLabelText(/on failure/i);
      expect(failureSelect).toBeInTheDocument();
      expect(failureSelect).toHaveValue('stop');
    });

    it('updates retries when changed', () => {
      render(<WorkflowMetadataForm />);
      expandErrorStrategy();

      const retriesInput = screen.getByLabelText(/retries/i);
      fireEvent.change(retriesInput, { target: { value: '3' } });

      expect(mockStore.setErrorStrategy).toHaveBeenCalledWith(
        expect.objectContaining({ retries: 3 })
      );
    });

    it('updates retry delay when changed', () => {
      render(<WorkflowMetadataForm />);
      expandErrorStrategy();

      const delayInput = screen.getByLabelText(/retry delay/i);
      fireEvent.change(delayInput, { target: { value: '10000' } });

      expect(mockStore.setErrorStrategy).toHaveBeenCalledWith(
        expect.objectContaining({ retryDelay: 10000 })
      );
    });

    it('updates on failure strategy when changed', () => {
      render(<WorkflowMetadataForm />);
      expandErrorStrategy();

      const failureSelect = screen.getByLabelText(/on failure/i);
      fireEvent.change(failureSelect, { target: { value: 'continue' } });

      expect(mockStore.setErrorStrategy).toHaveBeenCalledWith(
        expect.objectContaining({ onFailure: 'continue' })
      );
    });

    it('shows all on failure options', () => {
      render(<WorkflowMetadataForm />);
      expandErrorStrategy();

      const failureSelect = screen.getByLabelText(/on failure/i);
      expect(failureSelect).toContainElement(screen.getByText(/stop/i));
      expect(failureSelect).toContainElement(screen.getByText(/continue/i));
      expect(failureSelect).toContainElement(screen.getByText(/human.?review/i));
    });
  });

  describe('collapsible sections', () => {
    it('starts with triggers section collapsed', () => {
      render(<WorkflowMetadataForm />);

      // Trigger section header should be visible
      expect(screen.getByRole('button', { name: /triggers/i })).toBeInTheDocument();
      // Content should not be visible (schedule checkbox)
      expect(screen.queryByLabelText(/schedule/i)).not.toBeInTheDocument();
    });

    it('expands triggers section when clicked', () => {
      render(<WorkflowMetadataForm />);

      const triggersHeader = screen.getByRole('button', { name: /triggers/i });
      fireEvent.click(triggersHeader);

      expect(screen.getByLabelText(/schedule/i)).toBeVisible();
    });

    it('starts with error strategy section collapsed', () => {
      render(<WorkflowMetadataForm />);

      // Error strategy section header should be visible
      expect(screen.getByRole('button', { name: /error strategy/i })).toBeInTheDocument();
      // Content should not be visible
      expect(screen.queryByLabelText(/retries/i)).not.toBeInTheDocument();
    });

    it('expands error strategy section when clicked', () => {
      render(<WorkflowMetadataForm />);

      const errorStrategyHeader = screen.getByRole('button', { name: /error strategy/i });
      fireEvent.click(errorStrategyHeader);

      expect(screen.getByLabelText(/retries/i)).toBeVisible();
    });
  });
});
