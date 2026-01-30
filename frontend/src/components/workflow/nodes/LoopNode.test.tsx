import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoopNode } from './LoopNode'

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

describe('LoopNode', () => {
  it('renders with default label when no data label provided', () => {
    render(<LoopNode data={{}} />)

    expect(screen.getByText('Loop')).toBeInTheDocument()
    expect(screen.getByText('Loop Node')).toBeInTheDocument()
  })

  it('renders custom label from data', () => {
    render(<LoopNode data={{ label: 'Process Items' }} />)

    expect(screen.getByText('Process Items')).toBeInTheDocument()
  })

  it('displays max iterations when provided', () => {
    render(<LoopNode data={{ maxIterations: 10 }} />)

    expect(screen.getByText('Max: 10 iterations')).toBeInTheDocument()
  })

  it('does not display max iterations when not provided', () => {
    render(<LoopNode data={{}} />)

    expect(screen.queryByText(/Max:/)).not.toBeInTheDocument()
  })

  it('displays condition when provided', () => {
    render(<LoopNode data={{ condition: 'items.length > 0' }} />)

    expect(screen.getByText('items.length > 0')).toBeInTheDocument()
  })

  it('does not display condition when not provided', () => {
    const { container } = render(<LoopNode data={{}} />)

    const monoElements = container.querySelectorAll('.font-mono')
    expect(monoElements).toHaveLength(0)
  })

  it('renders input and output handles', () => {
    render(<LoopNode data={{}} />)

    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument()
  })

  it('applies selected styling when selected', () => {
    const { container } = render(<LoopNode data={{}} selected={true} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-green-500')
    expect(nodeDiv.className).toContain('shadow-lg')
  })

  it('applies default styling when not selected', () => {
    const { container } = render(<LoopNode data={{}} selected={false} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-gray-300')
  })

  it('renders green indicator dot', () => {
    const { container } = render(<LoopNode data={{}} />)

    const dot = container.querySelector('.bg-green-500')
    expect(dot).toBeInTheDocument()
  })

  it('renders both maxIterations and condition when both provided', () => {
    render(<LoopNode data={{ maxIterations: 5, condition: 'hasMore' }} />)

    expect(screen.getByText('Max: 5 iterations')).toBeInTheDocument()
    expect(screen.getByText('hasMore')).toBeInTheDocument()
  })
})
