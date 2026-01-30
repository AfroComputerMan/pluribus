import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ParallelNode } from './ParallelNode'

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

describe('ParallelNode', () => {
  it('renders with default label when no data label provided', () => {
    render(<ParallelNode data={{}} />)

    expect(screen.getByText('Parallel')).toBeInTheDocument()
    expect(screen.getByText('Parallel Node')).toBeInTheDocument()
  })

  it('renders custom label from data', () => {
    render(<ParallelNode data={{ label: 'Parallel Processing' }} />)

    expect(screen.getByText('Parallel Processing')).toBeInTheDocument()
  })

  it('defaults to 2 branches when not specified', () => {
    render(<ParallelNode data={{}} />)

    expect(screen.getByText(/2 branches/)).toBeInTheDocument()
  })

  it('displays correct branch count from data', () => {
    render(<ParallelNode data={{ branches: ['a', 'b', 'c'] }} />)

    expect(screen.getByText(/3 branches/)).toBeInTheDocument()
  })

  it('displays default join strategy when not specified', () => {
    render(<ParallelNode data={{}} />)

    expect(screen.getByText(/branches \| all/)).toBeInTheDocument()
  })

  it('displays custom join strategy from data', () => {
    render(<ParallelNode data={{ joinStrategy: 'race' }} />)

    expect(screen.getByText(/race/)).toBeInTheDocument()
  })

  it('renders input handle', () => {
    render(<ParallelNode data={{}} />)

    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument()
  })

  it('renders 2 output handles by default', () => {
    render(<ParallelNode data={{}} />)

    expect(screen.getByTestId('handle-source-bottom-branch-0')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom-branch-1')).toBeInTheDocument()
  })

  it('renders correct number of output handles based on branches', () => {
    render(<ParallelNode data={{ branches: ['a', 'b', 'c', 'd'] }} />)

    expect(screen.getByTestId('handle-source-bottom-branch-0')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom-branch-1')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom-branch-2')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom-branch-3')).toBeInTheDocument()
  })

  it('applies selected styling when selected', () => {
    const { container } = render(<ParallelNode data={{}} selected={true} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-purple-500')
    expect(nodeDiv.className).toContain('shadow-lg')
  })

  it('applies default styling when not selected', () => {
    const { container } = render(<ParallelNode data={{}} selected={false} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-gray-300')
  })

  it('renders purple indicator dot', () => {
    const { container } = render(<ParallelNode data={{}} />)

    const dot = container.querySelector('.bg-purple-500')
    expect(dot).toBeInTheDocument()
  })
})
