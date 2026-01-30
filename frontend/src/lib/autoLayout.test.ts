import { describe, it, expect } from 'vitest'
import { applyDagreLayout, getNodesBounds } from './autoLayout'
import type { Node, Edge } from '@xyflow/react'

describe('applyDagreLayout', () => {
  it('returns empty array for empty nodes', () => {
    const result = applyDagreLayout([], [])
    expect(result).toEqual([])
  })

  it('positions a single node', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = []

    const result = applyDagreLayout(nodes, edges)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('node-1')
    expect(typeof result[0].position.x).toBe('number')
    expect(typeof result[0].position.y).toBe('number')
  })

  it('positions connected nodes hierarchically', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: {} },
      { id: 'node-2', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ]

    const result = applyDagreLayout(nodes, edges)

    expect(result).toHaveLength(2)
    // In TB direction, node-1 should be above node-2
    const node1 = result.find((n) => n.id === 'node-1')!
    const node2 = result.find((n) => n.id === 'node-2')!
    expect(node1.position.y).toBeLessThan(node2.position.y)
  })

  it('respects direction option LR', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: {} },
      { id: 'node-2', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ]

    const result = applyDagreLayout(nodes, edges, { direction: 'LR' })

    const node1 = result.find((n) => n.id === 'node-1')!
    const node2 = result.find((n) => n.id === 'node-2')!
    // In LR direction, node-1 should be left of node-2
    expect(node1.position.x).toBeLessThan(node2.position.x)
  })

  it('uses custom node dimensions', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: {} },
      { id: 'node-2', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ]

    const resultDefault = applyDagreLayout(nodes, edges)
    const resultCustom = applyDagreLayout(nodes, edges, {
      nodeWidth: 300,
      nodeHeight: 150,
    })

    // Different dimensions should result in different positions
    const node2Default = resultDefault.find((n) => n.id === 'node-2')!
    const node2Custom = resultCustom.find((n) => n.id === 'node-2')!
    expect(node2Default.position.y).not.toBe(node2Custom.position.y)
  })

  it('preserves node data', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'Test', custom: 123 } },
    ]

    const result = applyDagreLayout(nodes, [])

    expect(result[0].data).toEqual({ label: 'Test', custom: 123 })
  })

  it('handles complex DAG with multiple branches', () => {
    const nodes: Node[] = [
      { id: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'branch-a', position: { x: 0, y: 0 }, data: {} },
      { id: 'branch-b', position: { x: 0, y: 0 }, data: {} },
      { id: 'end', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'start', target: 'branch-a' },
      { id: 'e2', source: 'start', target: 'branch-b' },
      { id: 'e3', source: 'branch-a', target: 'end' },
      { id: 'e4', source: 'branch-b', target: 'end' },
    ]

    const result = applyDagreLayout(nodes, edges)

    expect(result).toHaveLength(4)
    const start = result.find((n) => n.id === 'start')!
    const end = result.find((n) => n.id === 'end')!
    // Start should be above end
    expect(start.position.y).toBeLessThan(end.position.y)
  })
})

describe('getNodesBounds', () => {
  it('returns zero bounds for empty nodes', () => {
    const result = getNodesBounds([])
    expect(result).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('calculates bounds for single node', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: 100, y: 50 }, data: {} },
    ]

    const result = getNodesBounds(nodes)

    expect(result).toEqual({ x: 100, y: 50, width: 0, height: 0 })
  })

  it('calculates bounds for multiple nodes', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: {} },
      { id: 'node-2', position: { x: 200, y: 100 }, data: {} },
      { id: 'node-3', position: { x: 50, y: 150 }, data: {} },
    ]

    const result = getNodesBounds(nodes)

    expect(result).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 150,
    })
  })

  it('handles negative positions', () => {
    const nodes: Node[] = [
      { id: 'node-1', position: { x: -100, y: -50 }, data: {} },
      { id: 'node-2', position: { x: 100, y: 50 }, data: {} },
    ]

    const result = getNodesBounds(nodes)

    expect(result).toEqual({
      x: -100,
      y: -50,
      width: 200,
      height: 100,
    })
  })
})
