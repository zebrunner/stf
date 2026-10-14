import {SimpleGrid} from '@mantine/core'
import type {PaneProps} from '../../types'
import {DeviceSettingsCard} from './DeviceSettingsCard'
import {StoreAccountCard} from './StoreAccountCard'

export default function AutomationPane({device, control}: PaneProps) {
  return (
    <SimpleGrid minColWidth='min(380px, 100%)' autoFlow='auto-fit' spacing='md' className='stf-automation'>
      <StoreAccountCard control={control} />
      <DeviceSettingsCard device={device} control={control} />
    </SimpleGrid>
  )
}
