import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentNode } from './AgentNode'

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

describe('AgentNode', () => {
  it('renders with default label when no data label provided', () => {
    render(<AgentNode data={{}} />)

    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('Agent Node')).toBeInTheDocument()
  })

  it('renders custom label from data', () => {
    render(<AgentNode data={{ label: 'My Custom Agent' }} />)

    expect(screen.getByText('My Custom Agent')).toBeInTheDocument()
  })

  it('displays agent ID when provided', () => {
    render(<AgentNode data={{ agentId: 'agent-123' }} />)

    expect(screen.getByText('ID: agent-123')).toBeInTheDocument()
  })

  it('does not display agent ID when not provided', () => {
    render(<AgentNode data={{}} />)

    expect(screen.queryByText(/^ID:/)).not.toBeInTheDocument()
  })

  it('renders input and output handles', () => {
    render(<AgentNode data={{}} />)

    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument()
  })

  it('applies selected styling when selected', () => {
    const { container } = render(<AgentNode data={{}} selected={true} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-blue-500')
    expect(nodeDiv.className).toContain('shadow-lg')
  })

  it('applies default styling when not selected', () => {
    const { container } = render(<AgentNode data={{}} selected={false} />)

    const nodeDiv = container.firstChild as HTMLElement
    expect(nodeDiv.className).toContain('border-gray-300')
  })

  it('renders blue indicator dot', () => {
    const { container } = render(<AgentNode data={{}} />)

    const dot = container.querySelector('.bg-blue-500')
    expect(dot).toBeInTheDocument()
  })
})
