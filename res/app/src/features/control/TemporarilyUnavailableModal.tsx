// Fork (Zebrunner): shown when the iOS device unit reports that the device is temporarily
// unavailable (TemporarilyUnavailableMessage)
import {Button, Group, Modal, Stack, Text} from '@mantine/core'
import {IconRefresh, IconSitemap} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'

export function TemporarilyUnavailableModal({message, onReconnect, onLeave, onDismiss}: {
  message: string
  onReconnect: () => void
  onLeave: () => void
  onDismiss: () => void
}) {
  const {t} = useTranslation()
  return (
    <Modal
      opened
      onClose={onDismiss}
      centered
      title={<Text fw={600} c='red'>{t('Disconnected')}</Text>}
      classNames={{content: 'temporarily-unavailable-modal'}}
    >
      <Stack align='center' gap='md' id='temporarily-unavailable'>
        <IconSitemap size={44} stroke={1.3} />
        <Text ta='center'>{t(message)}</Text>
        <Group justify='space-between' w='100%' mt='md'>
          <Button leftSection={<IconRefresh size={16} />} onClick={onReconnect}>
            {t('Try to reconnect')}
          </Button>
          <Button variant='light' color='green' leftSection={<IconSitemap size={16} />} onClick={onLeave}>
            {t('Go to Device List')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
