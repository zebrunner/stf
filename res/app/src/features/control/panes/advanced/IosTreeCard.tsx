import {useState} from 'react'
import {ActionIcon, Button, Code, Group, ScrollArea, Stack, Text} from '@mantine/core'
import {IconRefresh, IconSitemap} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'

interface TreeNode {
  label?: string
  name?: string
  type?: string
  value?: string
  children?: TreeNode[]
  [key: string]: unknown
}

function normalizeNodes(value: unknown): TreeNode[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is TreeNode => Boolean(item && typeof item === 'object'))
  }
  if (value && typeof value === 'object') {
    const node = value as TreeNode
    const nested = node.children ?? (node.data as TreeNode[] | undefined)
    return nested ? normalizeNodes(nested) : [node]
  }
  return []
}

function nodeLabel(node: TreeNode): string {
  return String(node.label || node.name || node.type || node.value || 'Element')
}

function TreeRows({nodes, control}: {nodes: TreeNode[], control: PaneProps['control']}) {
  return (
    <Stack gap={4}>
      {nodes.map((node, index) => {
        const label = nodeLabel(node)
        const children = normalizeNodes(node.children)
        return (
          <div key={`${label}-${index}`}>
            <Group gap={4} wrap='nowrap'>
              <ActionIcon
                size='xs'
                variant='subtle'
                aria-label={label}
                onClick={() => control.tapDeviceTreeElement(label)}
              >
                <IconSitemap size={12} />
              </ActionIcon>
              <Text size='xs' className='selectable'>{label}</Text>
            </Group>
            {children.length > 0 && (
              <div style={{paddingLeft: 18}}>
                <TreeRows nodes={children} control={control} />
              </div>
            )}
          </div>
        )
      })}
    </Stack>
  )
}

export function IosTreeCard({control}: Pick<PaneProps, 'control'>) {
  const {t} = useTranslation()
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    setLoading(true)
    setError(null)
    control.getTreeElements()
      .then((result) => setNodes(normalizeNodes(result.lastData ?? result.body)))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setLoading(false))
  }

  return (
    <WidgetCard
      title={t('iOS Element Tree')}
      icon={IconSitemap}
      color='cyan'
      className='stf-ios-tree'
      actions={(
        <Button
          size='compact-xs'
          variant='light'
          leftSection={<IconRefresh size={14} />}
          loading={loading}
          onClick={refresh}
        >
          {t('Refresh')}
        </Button>
      )}
    >
      {error && <Code color='red'>{error}</Code>}
      <ScrollArea.Autosize mah={360}>
        {nodes.length > 0 ?
          <TreeRows nodes={nodes} control={control} /> :
          <Text size='sm' c='dimmed'>{t('No elements loaded')}</Text>}
      </ScrollArea.Autosize>
    </WidgetCard>
  )
}
