import {SimpleGrid} from '@mantine/core'
import type {PaneProps} from '../../types'
import {DeviceSettingsCard} from '../automation/DeviceSettingsCard'
import {IosDeviceSettingsCard} from '../automation/zebrunner-ios-settings'
import {AdvancedInputCard} from './AdvancedInputCard'
import {MaintenanceCard} from './MaintenanceCard'
import {PortForwardingCard} from './PortForwardingCard'

export default function AdvancedPane({device, control}: PaneProps) {
  return (
    <SimpleGrid minColWidth='min(380px, 100%)' autoFlow='auto-fit' spacing='md' className='stf-advanced'>
      <AdvancedInputCard control={control} />
      {/* Fork (Zebrunner): iOS switches Wi-Fi and Bluetooth in Settings, tvOS has neither; iOS has no reverse port forwarding */}
      {!device.ios && <DeviceSettingsCard device={device} control={control} />}
      {device.ios && device.platform !== 'tvOS' && <IosDeviceSettingsCard control={control} />}
      {!device.ios && <PortForwardingCard device={device} control={control} />}
      <MaintenanceCard control={control} />
    </SimpleGrid>
  )
}
