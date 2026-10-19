// Fork (Zebrunner): Wi-Fi and Bluetooth of an iOS device. The device switches them in its Settings
// app (lib/units/ios-device/plugins/radio.ts), which takes the screen for a few seconds, so their
// state is read on demand only instead of when the card opens
import {useState, type ReactNode} from 'react'
import {ActionIcon, Center, Group, Loader, SegmentedControl, Stack, Text, Tooltip} from '@mantine/core'
import {IconBluetooth, IconRefresh, IconSettings, IconWifi} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import type {TransactionResult} from '@/core/transaction'
import {translate, useTranslation} from '@/core/i18n'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from './AutomationPane.module.css'

interface Radio {
  read: (control: Control) => Promise<TransactionResult>
  write: (control: Control, enabled: boolean) => Promise<TransactionResult>
  enabled: string
}

const wifi: Radio = {
  read: (control) => control.getWifiStatus()
  , write: (control, enabled) => control.setWifiEnabled(enabled)
  , enabled: 'wifi_enabled'
}

const bluetooth: Radio = {
  read: (control) => control.getBluetoothStatus()
  , write: (control, enabled) => control.setBluetoothEnabled(enabled)
  , enabled: 'bluetooth_enabled'
}

// radioState <result> <radio> [fallback]: the state the device answered, the requested one when the
// answer has none
export function radioState(result: TransactionResult, radio: Radio, fallback?: boolean): boolean {
  if (typeof result.lastData === 'string' && result.lastData) {
    return result.lastData === radio.enabled
  }
  return Boolean(fallback)
}

function RadioRow({control, radio, icon, label}: {
  control: Control
  radio: Radio
  icon: ReactNode
  label: string
}) {
  const {t} = useTranslation()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  function run(action: Promise<TransactionResult>, fallback?: boolean) {
    setBusy(true)
    action
      .then((result) => setEnabled(radioState(result, radio, fallback)))
      .catch((error: unknown) => notifyFailure(error, translate('Device Settings')))
      .finally(() => setBusy(false))
  }

  return (
    <Group justify='space-between' wrap='wrap' gap='sm' className={classes.settingRow}>
      <Group gap='sm' wrap='nowrap'>
        {icon}
        <Text size='sm' fw={500}>{label}</Text>
      </Group>
      <Group gap='sm' wrap='nowrap'>
        <Tooltip label={t('Read the state from the device')}>
          <ActionIcon
            variant='subtle'
            color='gray'
            disabled={busy}
            onClick={() => run(radio.read(control))}
            aria-label={t('Read the state from the device')}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
        {busy ?
          <Center w={96} h={24}><Loader size='xs' /></Center> :
          <SegmentedControl
            size='xs'
            w={96}
            value={enabled === null ? '' : String(enabled)}
            onChange={(value) => run(radio.write(control, value === 'true'), value === 'true')}
            aria-label={label}
            data={[
              {value: 'false', label: t('Off')}
              , {value: 'true', label: t('On')}
            ]}
          />}
      </Group>
    </Group>
  )
}

export function IosDeviceSettingsCard({control}: {control: Control}) {
  const {t} = useTranslation()

  return (
    <WidgetCard title={t('Device Settings')} icon={IconSettings} color='gray' className='stf-device-settings'>
      <Stack gap={0}>
        <RadioRow control={control} radio={wifi} icon={<IconWifi size={18} />} label={t('WiFi')} />
        <RadioRow control={control} radio={bluetooth} icon={<IconBluetooth size={18} />} label={t('Bluetooth')} />
        <Text size='xs' c='dimmed' pt='xs'>
          {t('The device switches them in its Settings app, which takes the screen for a few seconds')}
        </Text>
      </Stack>
    </WidgetCard>
  )
}
