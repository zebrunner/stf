import {SimpleGrid} from '@mantine/core'
import {usePlatform} from '@/ui/modes'
import type {PaneProps} from '../../types'
import {AppsCard} from './apps/AppsCard'
import {ClipboardCard} from './clipboard/ClipboardCard'
import {InstallCard} from './install/InstallCard'
import {NavigationCard} from './navigation/NavigationCard'
import {RemoteDebugCard} from './remote-debug/RemoteDebugCard'
import {ShellCard} from './shell/ShellCard'

export default function DashboardPane({device, control}: PaneProps) {
  const [platform] = usePlatform()
  const ios = Boolean(device.ios)

  return (
    <SimpleGrid type='container' cols={{base: 1, '720px': 2}} spacing='md' verticalSpacing='md'>
      <NavigationCard device={device} control={control} />
      <ClipboardCard control={control} />
      <InstallCard control={control} />
      {platform === 'native' && !ios && <ShellCard control={control} />}
      <AppsCard control={control} />
      {!ios && <RemoteDebugCard device={device} control={control} />}
    </SimpleGrid>
  )
}
