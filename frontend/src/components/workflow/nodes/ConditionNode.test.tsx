import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConditionNode } from './ConditionNode'

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

describe('ConditionNode', () => {
  it('renders with default label when no data label provided', () => {
    render(<ConditionNode data={{}} />)

    expect(screen.getByText('Condition')).toBeInTheDocument()
    expect(screen.getByText('Condition Node')).toBeInTheDocument()
  })

  it('renders custom label from data', () => {
    render(<ConditionNode data={{ label: 'Is User Admin?' }} />)

    expect(screen.getByText('Is User Admin?')).toBeInTheDocument()
  })

  it('displays expression when provided', () => {
    render(<ConditionNode data={{ expression: 'user.role === "admin"' }} />)

    expect(screen.getByText('user.role === "admin"')).toBeInTheDocument()
  })

  it('does not display expression when not provided', () => {
    const { container } = render(<ConditionNode data={{}} />)

    const monoElements = container.querySelectorAll('.font-mono')
    expect(monoElements).toHaveLength(0)
  })

  it('renders input handle and two output handles (true/false)', () => {
    render(<ConditionNode data={{}} />)

    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom-true')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom-false')).toBeInTheDocument()
  })

  it('applies selected styling when selected', () => {
    const { container } = render(<ConditionNode data={{}} selected={true} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-yellow-500')
    expect(nodeDiv.className).toContain('shadow-lg')
  })

  it('applies default styling when not selected', () => {
    const { container } = render(<ConditionNode data={{}} selected={false} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-gray-300')
  })

  it('renders yellow indicator dot', () => {
    const { container } = render(<ConditionNode data={{}} />)

    const dot = container.querySelector('.bg-yellow-500')
    expect(dot).toBeInTheDocument()
  })
})
