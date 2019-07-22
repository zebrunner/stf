#!/bin/bash

kill_processes()
{
  processes_pids=$1
  if [ "${processes_pids}" != "" ]; then
	echo processes_pids: $processes_pids
	kill -9 $processes_pids
  fi
}

BASEDIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )

echo Killing stf processes...
export pids=`ps -eaf | grep stf | grep 'node' | grep -v grep | awk '{ print $2 }'`
kill_processes "$pids"

killall rethinkdb
