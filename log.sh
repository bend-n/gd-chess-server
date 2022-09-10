#!/usr/bin/env bash

heroku logs --tail --app=gd-chess-server | while read -r LINE; do
    FILTERED=$(echo "$LINE" | pcregrep "[0-9]{4}-[0-9]+-[0-9]+.[0-9]{2}:[0-9]{2}:[0-9]{2}.[0-9]+\+[0-9]{2}:[0-9]{2}\s.+\[[^r].+\]:\s.+")
    [[ -z $FILTERED ]] && continue
    echo -ne "\e[0;36m$(date -d "$(echo "$FILTERED" | cut -d ' ' -f 1)" +%X): \e[0m"
    echo "$FILTERED" | cut -d ' ' -f 2-
done
