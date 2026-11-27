# A machine like the server CloudWall runs on (Ubuntu 24.04 with systemd as PID 1), for rehearsing
# install, upgrade and rollback against a real service manager. See README.md beside this file.
ARG BASE=ubuntu:24.04
FROM ${BASE}
# Behind an HTTPS-only proxy: --build-arg APT_PROXY=http://host:port --build-arg CA=<file in this folder>
ARG APT_PROXY=
ARG CA=
COPY . /tmp/build/
RUN if [ -n "$APT_PROXY" ]; then \
      printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' "$APT_PROXY" "$APT_PROXY" > /etc/apt/apt.conf.d/99proxy; \
      sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources; fi \
 && if [ -n "$CA" ]; then printf 'Acquire::https::CaInfo "/tmp/build/%s";\n' "$CA" >> /etc/apt/apt.conf.d/99proxy; fi \
 && apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
      systemd systemd-sysv dbus dbus-user-session python3 sudo procps iproute2 curl ca-certificates sqlite3 make \
 && rm -rf /var/lib/apt/lists/* \
 && (id ubuntu || useradd -m -s /bin/bash ubuntu) && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
