import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NodePalette } from './NodePalette'

describe('NodePalette', () => {
  it('renders all 5 node types', () => {
    render(<NodePalette />)

    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('Condition')).toBeInTheDocument()
    expect(screen.getByText('Parallel')).toBeInTheDocument()
    expect(screen.getByText('Loop')).toBeInTheDocument()
    expect(screen.getByText('Human Review')).toBeInTheDocument()
  })

  it('renders node descriptions', () => {
    render(<NodePalette />)

    expect(screen.getByText('Execute an AI agent')).toBeInTheDocument()
    expect(screen.getByText('Branch based on condition')).toBeInTheDocument()
    expect(screen.getByText('Execute multiple branches')).toBeInTheDocument()
    expect(screen.getByText('Iterate over items')).toBeInTheDocument()
    expect(screen.getByText('Manual approval step')).toBeInTheDocument()
  })

  it('renders node icons', () => {
    render(<NodePalette />)

    expect(screen.getByText('🤖')).toBeInTheDocument()
    expect(screen.getByText('🔀')).toBeInTheDocument()
    expect(screen.getByText('⚡')).toBeInTheDocument()
    expect(screen.getByText('🔄')).toBeInTheDocument()
    expect(screen.getByText('👤')).toBeInTheDocument()
  })

  it('renders the tip section', () => {
    render(<NodePalette />)

    expect(screen.getByText('Tip')).toBeInTheDocument()
    expect(screen.getByText(/Drag nodes onto the canvas/)).toBeInTheDocument()
  })

  it('sets correct data on drag start for agent node', () => {
    render(<NodePalette />)

    const agentNode = screen.getByText('Agent').closest('[draggable="true"]')!
    const mockDataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    }

    fireEvent.dragStart(agentNode, { dataTransfer: mockDataTransfer })

    expect(mockDataTransfer.setData).toHaveBeenCalledWith('application/reactflow', 'agent')
    expect(mockDataTransfer.effectAllowed).toBe('move')
  })

  it('sets correct data on drag start for condition node', () => {
    render(<NodePalette />)

    const conditionNode = screen.getByText('Condition').closest('[draggable="true"]')!
    const mockDataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    }

    fireEvent.dragStart(conditionNode, { dataTransfer: mockDataTransfer })

    expect(mockDataTransfer.setData).toHaveBeenCalledWith('application/reactflow', 'condition')
  })

  it('sets correct data on drag start for parallel node', () => {
    render(<NodePalette />)

    const parallelNode = screen.getByText('Parallel').closest('[draggable="true"]')!
    const mockDataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    }

    fireEvent.dragStart(parallelNode, { dataTransfer: mockDataTransfer })

    expect(mockDataTransfer.setData).toHaveBeenCalledWith('application/reactflow', 'parallel')
  })

  it('sets correct data on drag start for loop node', () => {
    render(<NodePalette />)

    const loopNode = screen.getByText('Loop').closest('[draggable="true"]')!
    const mockDataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    }

    fireEvent.dragStart(loopNode, { dataTransfer: mockDataTransfer })

    expect(mockDataTransfer.setData).toHaveBeenCalledWith('application/reactflow', 'loop')
  })

  it('sets correct data on drag start for human-review node', () => {
    render(<NodePalette />)

    const humanReviewNode = screen.getByText('Human Review').closest('[draggable="true"]')!
    const mockDataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    }

    fireEvent.dragStart(humanReviewNode, { dataTransfer: mockDataTransfer })

    expect(mockDataTransfer.setData).toHaveBeenCalledWith('application/reactflow', 'human-review')
  })

  it('makes all node items draggable', () => {
    render(<NodePalette />)

    const draggableItems = document.querySelectorAll('[draggable="true"]')
    expect(draggableItems).toHaveLength(5)
  })
})
