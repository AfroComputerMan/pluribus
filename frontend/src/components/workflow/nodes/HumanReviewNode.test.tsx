import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HumanReviewNode } from './HumanReviewNode'

// Mock React Flow Handle component
vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position, id }: { type: string; position: string; id?: string }) => (
    <div data-testid={`handle-${type}-${position}${id ? `-${id}` : ''}`} />
  ),
  Position: {
    Top: 'top',
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
  },
}))

describe('HumanReviewNode', () => {
  it('renders with default label when no data label provided', () => {
    render(<HumanReviewNode data={{}} />)

    expect(screen.getByText('Human Review')).toBeInTheDocument()
    expect(screen.getByText('Human Review Node')).toBeInTheDocument()
  })

  it('renders custom label from data', () => {
    render(<HumanReviewNode data={{ label: 'Manager Approval' }} />)

    expect(screen.getByText('Manager Approval')).toBeInTheDocument()
  })

  it('displays prompt when provided', () => {
    render(<HumanReviewNode data={{ prompt: 'Please review the document' }} />)

    expect(screen.getByText('Please review the document')).toBeInTheDocument()
  })

  it('does not display prompt when not provided', () => {
    render(<HumanReviewNode data={{}} />)

    // Only header text and default label should exist
    expect(screen.queryByText(/Please/)).not.toBeInTheDocument()
  })

  it('displays timeout when provided', () => {
    render(<HumanReviewNode data={{ timeout: 3600 }} />)

    expect(screen.getByText('Timeout: 3600s')).toBeInTheDocument()
  })

  it('does not display timeout when not provided', () => {
    render(<HumanReviewNode data={{}} />)

    expect(screen.queryByText(/Timeout:/)).not.toBeInTheDocument()
  })

  it('renders input and output handles', () => {
    render(<HumanReviewNode data={{}} />)

    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument()
  })

  it('applies selected styling when selected', () => {
    const { container } = render(<HumanReviewNode data={{}} selected={true} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-orange-500')
    expect(nodeDiv.className).toContain('shadow-lg')
  })

  it('applies default styling when not selected', () => {
    const { container } = render(<HumanReviewNode data={{}} selected={false} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-gray-300')
  })

  it('renders orange indicator dot', () => {
    const { container } = render(<HumanReviewNode data={{}} />)

    const dot = container.querySelector('.bg-orange-500')
    expect(dot).toBeInTheDocument()
  })

  it('renders both prompt and timeout when both provided', () => {
    render(<HumanReviewNode data={{ prompt: 'Approve this?', timeout: 300 }} />)

    expect(screen.getByText('Approve this?')).toBeInTheDocument()
    expect(screen.getByText('Timeout: 300s')).toBeInTheDocument()
  })
})
